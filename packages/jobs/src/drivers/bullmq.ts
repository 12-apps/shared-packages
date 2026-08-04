/**
 * The BULLMQ driver — the production path.
 *
 * ## What Redis is, and is not
 *
 * It is the EXECUTOR: what runs next, how many at once, when to retry. It is
 * never the ledger. Payloads carry ids (see `JobDefinition`'s payload rule),
 * every handler re-reads its row, and every job is paired with a durable table
 * a sweep can re-derive the work from. Losing Redis therefore costs a delayed
 * run — not a lost charge, and not a double one.
 *
 * That split is what makes the enqueue-outside-the-transaction problem
 * survivable. A Prisma commit followed by an enqueue is not atomic: crash in
 * between and the job never lands. The paired sweep is the answer — the row is
 * committed, so the next tick finds it.
 *
 * ## Redis configuration this driver depends on
 *
 * `maxmemory-policy` MUST be `noeviction`. Under any `allkeys-*` policy Redis
 * will evict live queue keys under pressure and BullMQ loses jobs silently.
 * The driver checks on start and complains loudly rather than trusting it.
 * Persistence (AOF) should be on: a restart otherwise drops delayed jobs, and
 * the schedules are re-installed on boot but pending retries are not.
 */

import { Queue, UnrecoverableError, Worker, type JobsOptions } from "bullmq";

import type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  JobContext,
  JobDriver,
  JobLogger,
} from "../core/types";

import { parseRedisUrl, type RedisConnectionOptions } from "./redis-url";

/** The queue a definition lands on when it does not name one. */
const DEFAULT_QUEUE = "default";
/** Worker concurrency when no definition in the queue asks for more. */
const DEFAULT_CONCURRENCY = 5;

/**
 * Retention. Bounded on purpose: an unbounded completed-set is the classic way
 * a small Redis fills up and starts refusing writes. A day of successes is
 * enough to answer "did it run?"; a week of failures is enough to debug one.
 */
const RETENTION: Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> = {
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
};

/** The one ioredis command this driver reads outside BullMQ's own surface. */
interface RedisConfigReader {
  config(command: "GET", parameter: string): Promise<unknown>;
}

export interface BullMqJobDriverOptions {
  /** `redis://[user:pass@]host:port[/db]`. */
  redisUrl: string;
  logger: JobLogger;
  /**
   * Key prefix, so one Redis can carry several environments without a staging
   * worker consuming production's jobs.
   */
  prefix?: string;
}

/** Everything the driver's helpers need, threaded instead of closed over. */
interface DriverState {
  connection: RedisConnectionOptions;
  logger: JobLogger;
  prefix?: string;
  queues: Map<string, Queue>;
  workers: Worker[];
}

/** Turn a definition's retry policy into BullMQ's per-job options. */
function jobOptionsFor(
  definition: AnyJobDefinition,
  enqueueOptions: EnqueueOptions,
): JobsOptions {
  const options: JobsOptions = {
    attempts: Math.max(1, definition.attempts ?? 1),
    ...RETENTION,
  };
  if (definition.backoff) {
    options.backoff = {
      type: definition.backoff.type,
      delay: definition.backoff.delayMs,
    };
  }
  if (enqueueOptions.delayMs) options.delay = enqueueOptions.delayMs;
  if (enqueueOptions.dedupeKey) {
    // BullMQ's own deduplication (not a hijacked `jobId`): the entry is
    // released when the job finishes, so a later, legitimately-identical run
    // is not swallowed by a retained completed job.
    options.deduplication = { id: enqueueOptions.dedupeKey };
  }
  return options;
}

function queueFor(state: DriverState, name: string): Queue {
  const existing = state.queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: state.connection,
    ...(state.prefix ? { prefix: state.prefix } : {}),
    defaultJobOptions: RETENTION,
  });
  // Without a listener an emitted 'error' is an unhandled exception that takes
  // the process down — a Redis blip must not kill the web server.
  queue.on("error", (error) => state.logger.error(`queue "${name}" error:`, error));
  state.queues.set(name, queue);
  return queue;
}

/**
 * Warn when Redis is configured to evict. Best-effort: managed providers
 * routinely forbid `CONFIG GET`, and an unanswerable check is not a reason to
 * refuse to start.
 */
async function checkEvictionPolicy(state: DriverState, queue: Queue): Promise<void> {
  try {
    // `CONFIG` is an ioredis command BullMQ's narrower client type does not
    // advertise. Reached through a structural type rather than a blanket cast,
    // and guarded — this is a diagnostic, not a dependency.
    const client = (await queue.client) as unknown as Partial<RedisConfigReader>;
    if (typeof client.config !== "function") return;
    const config = await client.config("GET", "maxmemory-policy");
    const policy = Array.isArray(config) ? String(config[1]) : "";
    if (policy && policy !== "noeviction") {
      state.logger.error(
        `Redis maxmemory-policy is "${policy}", not "noeviction" — queued jobs CAN be evicted and lost. Fix the Redis config.`,
      );
    }
  } catch {
    state.logger.info(
      "could not read Redis maxmemory-policy (provider restricts CONFIG).",
    );
  }
}

/**
 * Install every cron schedule and REMOVE the ones no longer declared in code.
 *
 * Without the removal half, a renamed or deleted cron job keeps firing forever
 * from Redis — the schedule outlives the deploy that created it, and lands on a
 * handler that no longer exists.
 */
async function reconcileSchedules(
  state: DriverState,
  queue: Queue,
  definitions: readonly AnyJobDefinition[],
): Promise<void> {
  const wanted = new Map(
    definitions.filter((job) => job.schedule).map((job) => [job.name, job]),
  );

  for (const [name, job] of wanted) {
    const schedule = job.schedule;
    if (!schedule) continue;
    await queue.upsertJobScheduler(
      name,
      { pattern: schedule.pattern, tz: schedule.timezone ?? "UTC" },
      { name, data: {}, opts: jobOptionsFor(job, {}) },
    );
    state.logger.info(
      `schedule installed: ${name} (${schedule.pattern} ${schedule.timezone ?? "UTC"})`,
    );
  }

  for (const scheduler of await queue.getJobSchedulers()) {
    if (wanted.has(scheduler.key)) continue;
    await queue.removeJobScheduler(scheduler.key);
    state.logger.warn(
      `removed stale schedule "${scheduler.key}" (no longer defined in code).`,
    );
  }
}

/**
 * A queue's worker concurrency.
 *
 * The default applies only when NO definition on the queue asked for a
 * specific number. A stated `concurrency: 1` means single-flight and must be
 * honoured — taking `max(default, …)` would quietly raise it back to the
 * default and undo the very property the caller asked for.
 */
function resolveConcurrency(group: readonly AnyJobDefinition[]): number {
  const stated = group
    .map((definition) => definition.concurrency)
    .filter((value): value is number => typeof value === "number" && value > 0);
  return stated.length > 0 ? Math.max(...stated) : DEFAULT_CONCURRENCY;
}

/** Consume one queue, dispatching by job name to the definitions it carries. */
function startWorker(
  state: DriverState,
  queueName: string,
  group: readonly AnyJobDefinition[],
): Worker {
  const byName = new Map(group.map((definition) => [definition.name, definition]));
  const concurrency = resolveConcurrency(group);

  const worker = new Worker(
    queueName,
    async (job) => {
      const definition = byName.get(job.name);
      if (!definition) {
        // A job left in Redis by a previous deploy whose handler is gone.
        // Retrying cannot help, so fail it terminally instead of burning every
        // attempt on it.
        throw new UnrecoverableError(`No handler registered for job "${job.name}".`);
      }
      const context: JobContext = {
        runId: job.id ?? `${job.name}:unknown`,
        attempt: job.attemptsMade + 1,
        maxAttempts: definition.attempts ?? 1,
        logger: state.logger,
      };
      await definition.handle(job.data as never, context);
    },
    {
      connection: state.connection,
      concurrency,
      ...(state.prefix ? { prefix: state.prefix } : {}),
    },
  );

  worker.on("failed", (job, error) => {
    const attempts = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : "?";
    state.logger.error(
      `job "${job?.name ?? queueName}" failed (attempt ${attempts}):`,
      error,
    );
  });
  worker.on("error", (error) =>
    state.logger.error(`worker "${queueName}" error:`, error),
  );
  return worker;
}

/** Definitions bucketed by the queue that carries them. */
function groupByQueue(
  definitions: readonly AnyJobDefinition[],
): Map<string, AnyJobDefinition[]> {
  const byQueue = new Map<string, AnyJobDefinition[]>();
  for (const definition of definitions) {
    const name = definition.queue ?? DEFAULT_QUEUE;
    const group = byQueue.get(name);
    if (group) group.push(definition);
    else byQueue.set(name, [definition]);
  }
  return byQueue;
}

export function createBullMqJobDriver(options: BullMqJobDriverOptions): JobDriver {
  const state: DriverState = {
    connection: parseRedisUrl(options.redisUrl),
    logger: options.logger,
    prefix: options.prefix,
    queues: new Map(),
    workers: [],
  };

  return {
    kind: "bullmq",

    async enqueue(definition, payload, enqueueOptions): Promise<EnqueueResult> {
      const queue = queueFor(state, definition.queue ?? DEFAULT_QUEUE);
      await queue.add(definition.name, payload, jobOptionsFor(definition, enqueueOptions));
      return { enqueued: true };
    },

    async start(definitions): Promise<void> {
      for (const [queueName, group] of groupByQueue(definitions)) {
        state.workers.push(startWorker(state, queueName, group));
        const queue = queueFor(state, queueName);
        await checkEvictionPolicy(state, queue);
        await reconcileSchedules(state, queue, group);
      }
    },

    async stop(): Promise<void> {
      // Workers first: `close()` waits for in-flight jobs, and closing the
      // queues underneath a running handler would fail its final update.
      await Promise.all(state.workers.map((worker) => worker.close()));
      state.workers.length = 0;
      await Promise.all([...state.queues.values()].map((queue) => queue.close()));
      state.queues.clear();
    },
  };
}

/**
 * Internals exposed for tests only — the concurrency rule is silent when
 * wrong, so it is pinned directly rather than inferred from a live Worker.
 */
export const __testables = { resolveConcurrency, DEFAULT_CONCURRENCY };
