/**
 * The BULLMQ driver — the production path.
 *
 * ## What Redis is, and is not
 *
 * It is the EXECUTOR: what runs next, how many at once, when to retry. It is
 * never the ledger. Payloads carry ids (see `JobDefinition`'s payload rule),
 * every handler re-reads its row, and every job is paired with a durable table
 * a sweep can re-derive the work from. Losing Redis therefore costs a delayed
 * run — not a lost write, and not a double one.
 *
 * That split is what makes the enqueue-outside-the-transaction problem
 * survivable. A database commit followed by an enqueue is not atomic: crash in
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

import { createEventEmitter, type EmitJobEvent } from "../core/events";
import { DEFAULT_QUEUE } from "../core/queues";
import { resolveRegisteredJob } from "../core/registry";
import type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  JobContext,
  JobDriver,
  JobEvents,
  JobLogger,
  JobRetention,
} from "../core/types";

import {
  DEFAULT_CONCURRENCY,
  DEFAULT_JOB_RETENTION,
  isTerminalFailure,
  resolveConcurrency,
  retentionOptions,
} from "./bullmq-policy";
import { parseRedisUrl, type RedisConnectionOptions } from "./redis-url";

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
  /** Defaults to {@link DEFAULT_JOB_RETENTION}. */
  retention?: JobRetention;
  /** Per-queue concurrency when no definition on the queue states one. */
  defaultConcurrency?: number;
  /** Where completions, dead-letters and removed schedules are reported. */
  events?: JobEvents;
}

/** Everything the driver's helpers need, threaded instead of closed over. */
interface DriverState {
  connection: RedisConnectionOptions;
  logger: JobLogger;
  prefix?: string;
  retention: Pick<JobsOptions, "removeOnComplete" | "removeOnFail">;
  defaultConcurrency: number;
  /** Reports to the host's observer; see `core/events`. Never throws. */
  emit: EmitJobEvent;
  queues: Map<string, Queue>;
  workers: Worker[];
}

/** Turn a definition's retry policy into BullMQ's per-job options. */
function jobOptionsFor(
  state: DriverState,
  definition: AnyJobDefinition,
  enqueueOptions: EnqueueOptions,
): JobsOptions {
  const options: JobsOptions = {
    attempts: Math.max(1, definition.attempts ?? 1),
    ...state.retention,
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
    defaultJobOptions: state.retention,
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
      { name, data: {}, opts: jobOptionsFor(state, job, {}) },
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
    // The destructive half of the reconcile, and the one worth auditing: a
    // deploy just cancelled a recurring job, permanently, from the queue's
    // point of view.
    state.emit((events) =>
      events.onScheduleRemoved?.({ name: scheduler.key, queue: queue.name }),
    );
  }
}

/** Consume one queue, dispatching by job name to the definitions it carries. */
function startWorker(
  state: DriverState,
  queueName: string,
  group: readonly AnyJobDefinition[],
): Worker {
  const onThisQueue = new Set(group.map((definition) => definition.name));
  const concurrency = resolveConcurrency(group, state.defaultConcurrency);

  const worker = new Worker(
    queueName,
    async (job) => {
      // THE GATE, execution side — `resolveRegisteredJob` is the same function
      // the enqueue path calls, so the two cannot come to disagree about what
      // a runnable job is. The queue membership check on top of it keeps a job
      // from being run by another queue's worker.
      const registered = resolveRegisteredJob(job.name);
      const definition = registered && onThisQueue.has(job.name) ? registered : undefined;
      if (!definition) {
        // A job left in the backend by a previous deploy whose handler is
        // gone. Retrying cannot help, so fail it terminally instead of burning
        // every attempt on it.
        throw new UnrecoverableError(`No handler registered for job "${job.name}".`);
      }
      const context: JobContext = {
        runId: job.id ?? `${job.name}:unknown`,
        attempt: job.attemptsMade + 1,
        maxAttempts: definition.attempts ?? 1,
        logger: state.logger,
      };
      await definition.handle(job.data as never, context);
      state.emit((events) =>
        events.onJobCompleted?.({
          name: job.name,
          queue: queueName,
          runId: context.runId,
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
        }),
      );
    },
    {
      connection: state.connection,
      concurrency,
      ...(state.prefix ? { prefix: state.prefix } : {}),
    },
  );

  worker.on("failed", (job, error) => {
    const maxAttempts = job?.opts.attempts ?? 1;
    const attempts = job ? `${job.attemptsMade}/${maxAttempts}` : "?";
    state.logger.error(
      `job "${job?.name ?? queueName}" failed (attempt ${attempts}):`,
      error,
    );
    if (!job) return;
    const terminal = isTerminalFailure(job.attemptsMade, maxAttempts, error);
    state.emit((events) =>
      events.onJobFailed?.({
        name: job.name,
        queue: queueName,
        runId: job.id ?? `${job.name}:unknown`,
        attempt: job.attemptsMade,
        maxAttempts,
        error,
        terminal,
      }),
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
    retention: retentionOptions(options.retention ?? DEFAULT_JOB_RETENTION),
    defaultConcurrency:
      typeof options.defaultConcurrency === "number" && options.defaultConcurrency > 0
        ? options.defaultConcurrency
        : DEFAULT_CONCURRENCY,
    emit: createEventEmitter(options.events, options.logger),
    queues: new Map(),
    workers: [],
  };

  return {
    kind: "bullmq",

    async enqueue(definition, payload, enqueueOptions): Promise<EnqueueResult> {
      // The same gate as the worker's dispatch, at the other end of the wire:
      // a name this deployment cannot run must not be written to Redis, where
      // it would sit until a consumer dead-lettered it. Reached directly only
      // by a host that built the driver itself — `enqueueJob` refuses first.
      if (!resolveRegisteredJob(definition)) {
        state.logger.error(
          `refused to enqueue "${definition.name}": it is not the job registered under that name.`,
        );
        return { enqueued: false, reason: "unregistered" };
      }
      const queue = queueFor(state, definition.queue ?? DEFAULT_QUEUE);
      await queue.add(
        definition.name,
        payload,
        jobOptionsFor(state, definition, enqueueOptions),
      );
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
 * The policy rules, re-exposed for tests through the driver's own subpath.
 *
 * Both are SILENT when wrong — a queue that quietly runs at the default
 * instead of single-flight, and a dead-letter that quietly reports itself as
 * one more retry — so they are pinned directly rather than inferred from a
 * live Worker, which would need a Redis to exist.
 */
export const __testables = {
  resolveConcurrency,
  isTerminalFailure,
  DEFAULT_CONCURRENCY,
};
