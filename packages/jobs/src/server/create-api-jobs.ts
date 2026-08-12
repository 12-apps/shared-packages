import { listJobs, type RegisteredJob } from "../core/registry";
import {
  configureJobs,
  getJobDriver,
  startJobWorkers,
  stopJobs,
} from "../core/runtime";
import type { JobDriver, JobLogger } from "../core/types";
import { createInlineJobDriver } from "../drivers/inline";
import {
  createSweepLease,
  type SweepLeaseDbProvider,
  type WithSweepLease,
} from "../lease/sweep-lease";

/**
 * `createApiJobs` — the jobs runtime as ONE mountable surface.
 *
 * The bootstrap used to live in the host: a runtime module that read the
 * environment, picked a driver, refused the unsafe one in production,
 * registered every job, started the workers and hooked the drain signals.
 * None of that is host domain — the only decisions a host genuinely owns are
 * WHICH jobs exist and WHERE the lease table lives, and both arrive here as
 * config.
 *
 * ## Two roles, one image
 *
 * A PRODUCER (the web server) configures the driver and enqueues. A CONSUMER
 * (the worker) does that and also starts consuming, which is the only
 * difference between the two — so the worker is the SAME container image with
 * `JOBS_WORKER=1` set, not a second build. Splitting the roles keeps a slow
 * job off the request path; running them in one process (set `JOBS_WORKER=1`
 * on the web service and skip the worker service) also works and is a
 * reasonable choice on a single small box.
 *
 * ## Fail closed, never fail loud
 *
 * A misconfigured queue must never take the host app down. Every problem here
 * (no `REDIS_URL` in production, `inline` requested in production, an
 * unparseable URL, `bullmq` failing to load) resolves to NO driver plus a
 * loud error: enqueues then report `no-driver` instead of throwing, the
 * durable rows still get written, and the sweeps catch up once a worker
 * exists. The health endpoint reports the same fact as a 503, so a probe can
 * see what the log line said.
 *
 * ## Zero config is a real mode
 *
 * `createApiJobs({ jobs })` with nothing else and no `REDIS_URL` in the
 * environment resolves to the INLINE driver outside production: handlers run
 * in-process, schedules do not fire (and say so), and the app starts green
 * with no Redis container. That is the default a fresh host is supposed to
 * boot in.
 */

/** What the driver choice may say (`JOBS_DRIVER`, or `config.driver`). */
export type JobsDriverChoice = "bullmq" | "inline" | "off";

/**
 * How the host names its jobs. An import thunk (`() => import("./jobs")`) is
 * the usual form — `defineJob` registers at module scope, so importing the
 * modules IS the registration. An array of already-registered jobs is
 * accepted for hosts (and tests) that hold the references anyway; it forces
 * the modules to have been imported, which is the same guarantee.
 */
export type JobsSource =
  | readonly RegisteredJob<never>[]
  | (() => unknown | Promise<unknown>);

export interface JobsServerConfig {
  /** Every job this process can enqueue or consume. See {@link JobsSource}. */
  jobs: JobsSource;
  /**
   * A driver INSTANCE (tests, exotic hosts), a choice by name, or unset to
   * resolve one: `JOBS_DRIVER` if set; else `bullmq` when a Redis URL exists;
   * else `off` in production and `inline` everywhere else.
   */
  driver?: JobDriver | JobsDriverChoice;
  /** `redis://[user:pass@]host:port[/db]`. Defaults to `REDIS_URL`. */
  redisUrl?: string;
  /**
   * Whether THIS process consumes the queue and runs the schedules, not just
   * enqueues. Defaults to `JOBS_WORKER` being `1` or `true`.
   */
  worker?: boolean;
  /**
   * Refuses the inline driver and makes "no queue" loud. Defaults to
   * `NODE_ENV === "production"`.
   */
  production?: boolean;
  /**
   * Queue key prefix, so one Redis can carry several environments without a
   * staging worker consuming production's jobs. Defaults to
   * `JOBS_QUEUE_PREFIX`.
   */
  queuePrefix?: string;
  /** The host's logger. Defaults to the console. */
  logger?: JobLogger;
  /**
   * Where the `sweep_leases` table lives — enables {@link JobsApi.withSweepLease}.
   * Omit it and the lease helper throws on first use, loudly, because a sweep
   * that silently skipped its lease would be the unprotected overlap the
   * lease exists to prevent.
   */
  db?: SweepLeaseDbProvider;
  /**
   * Install `SIGTERM`/`SIGINT` handlers that drain in-flight jobs on a deploy
   * (worker processes only). Defaults to true; turn it off in tests, which
   * must not leak process listeners.
   */
  installShutdownHooks?: boolean;
}

/** What a route handler answers; the host maps it onto its response type. */
export interface JobsResponse {
  status: number;
  body: unknown;
}

/** A framework-neutral route descriptor, the same shape report-builder mounts. */
export interface JobsRoute {
  method: "GET";
  /** Path relative to the host's jobs mount, e.g. `/health`. */
  path: string;
  handle(): Promise<JobsResponse>;
}

/** The health payload `GET /health` answers with. */
export interface JobsHealth {
  status: "ok" | "degraded";
  checks: {
    /**
     * `start()` has completed WITHOUT THROWING in this process. A start that
     * rejected (a duplicate job name, a failing registration import) leaves
     * this false and the status degraded — a failed boot must never probe
     * green.
     */
    configured: boolean;
    /** The resolved driver's kind, or null when jobs are disabled. */
    driver: string | null;
    /** Whether this process is meant to consume, not just enqueue. */
    worker: boolean;
    /** Whether consuming actually began (always false in a producer). */
    consuming: boolean;
    /** Registered job definitions. */
    jobs: number;
    /** How many of them run on a cron schedule. */
    schedules: number;
  };
}

export interface JobsApi {
  /** The health endpoint. Mount with `@12-apps/jobs/hono` or your own adapter. */
  routes: JobsRoute[];
  /**
   * Configure the driver, register every job, and — in a worker — start
   * consuming and install the cron schedules. Call it once at process start,
   * before the first request; safe to call again (no-op). Never throws for a
   * MISCONFIGURED queue (see "fail closed" above) — only for a programming
   * error such as a duplicate job name.
   */
  start(): Promise<void>;
  /** Stop consuming and release the driver's connections, draining in-flight jobs. */
  stop(): Promise<void>;
  /**
   * Single-writer lease for cron sweeps, bound to `config.db`. See
   * {@link createSweepLease} for the contract.
   */
  withSweepLease: WithSweepLease;
}

/** Fallback logger — used until the host passes its own. */
const consoleLogger: JobLogger = {
  info: (message, ...meta) => console.info(`[jobs] ${message}`, ...meta),
  warn: (message, ...meta) => console.warn(`[jobs] ${message}`, ...meta),
  error: (message, ...meta) => console.error(`[jobs] ${message}`, ...meta),
};

/** `JOBS_WORKER=1|true` is how a deployment marks the consuming process. */
function isWorkerProcess(): boolean {
  const flag = process.env.JOBS_WORKER?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

interface ResolvedConfig {
  redisUrl: string | undefined;
  production: boolean;
  worker: boolean;
  queuePrefix: string | undefined;
  logger: JobLogger;
}

function resolveChoice(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): JobsDriverChoice {
  if (typeof config.driver === "string") return config.driver;
  const configured = process.env.JOBS_DRIVER?.trim().toLowerCase();
  if (configured === "bullmq" || configured === "inline" || configured === "off") {
    return configured;
  }
  if (configured) {
    resolved.logger.error(
      `JOBS_DRIVER="${configured}" is not a driver; jobs are disabled.`,
    );
    return "off";
  }
  // Unset: Redis being configured is the signal that a queue exists.
  if (resolved.redisUrl) return "bullmq";
  return resolved.production ? "off" : "inline";
}

/**
 * Pick the driver, or NULL for "jobs are disabled in this process" — which is
 * always accompanied by a loud log line, never silent.
 */
async function resolveDriver(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): Promise<JobDriver | null> {
  // An instance passed in is the host's own decision; use it as-is.
  if (config.driver && typeof config.driver === "object") return config.driver;

  const choice = resolveChoice(config, resolved);
  const { logger, production, redisUrl } = resolved;

  if (choice === "off") {
    if (production) {
      logger.error(
        "No job driver: scheduled work will NOT run in this deployment. Set REDIS_URL.",
      );
    }
    return null;
  }

  if (choice === "inline") {
    if (production) {
      // Inline runs the handler inside whatever request enqueued it and has
      // no retries and no schedules. That is a development convenience, and
      // in production it would silently drop work a crash interrupts.
      logger.error("JOBS_DRIVER=inline is refused in production; jobs are disabled.");
      return null;
    }
    logger.info("using the inline job driver (no Redis): schedules will not fire.");
    // Detached on purpose: in a dev server the handler must not run inside
    // the request that enqueued it. A test that wants to await the handler
    // passes its own `createInlineJobDriver({ await: true })` instance.
    return createInlineJobDriver({ logger, await: false });
  }

  if (!redisUrl) {
    logger.error("JOBS_DRIVER=bullmq needs REDIS_URL; jobs are disabled.");
    return null;
  }
  try {
    // Imported lazily so `bullmq` (and ioredis) are pulled in only by a
    // process that actually talks to Redis — never into a bundle that only
    // enqueues. The specifier is a literal, which is what keeps it loadable
    // once the host bundles this package's published TS source.
    const { createBullMqJobDriver } = await import("../drivers/bullmq");
    return createBullMqJobDriver({
      redisUrl,
      logger,
      prefix: resolved.queuePrefix,
    });
  } catch (error) {
    logger.error("could not create the BullMQ driver; jobs are disabled:", error);
    return null;
  }
}

/** Trigger the host's registrations. An array means "already registered". */
async function registerJobs(jobs: JobsSource): Promise<void> {
  if (typeof jobs === "function") await jobs();
}

/** The lease bound to the configured db — or, without one, a loud refusal. */
function bindSweepLease(db: SweepLeaseDbProvider | undefined): WithSweepLease {
  const lease = db ? createSweepLease({ db }) : null;
  // Async so the refusal is a REJECTION, which is what the type promises: a
  // synchronous throw from a Promise-returning function escapes `.catch()`
  // and `Promise.all`, and a caller that collected the promise before
  // awaiting it would never see the error at all.
  return async (name, ttlMs, work) => {
    if (!lease) {
      // Loud, not silent: a sweep whose lease quietly no-ops is exactly the
      // unprotected concurrent pass the lease exists to prevent. Same rule as
      // the claim itself — only a lost race may be silent.
      throw new Error(
        "withSweepLease needs a `db` provider in createApiJobs({ db }).",
      );
    }
    return lease.withSweepLease(name, ttlMs, work);
  };
}

/** What one `start()`/`stop()` cycle has actually done in this process. */
interface RuntimeState {
  /**
   * `start()` has been ENTERED — the idempotency latch, exactly future-pay's
   * `bootstrapped` flag: a second call is a no-op, and a start that threw is
   * not retried by calling it again.
   */
  starting: boolean;
  /**
   * `start()` has COMPLETED without throwing — the success flag health keys
   * on. Kept separate from `starting` because a start that rejected must
   * leave the probe red, not report the half-configured runtime as ok.
   */
  started: boolean;
  consuming: boolean;
}

function healthOf(state: RuntimeState, worker: boolean): JobsHealth {
  const definitions = listJobs();
  const driver = getJobDriver();
  const ready = state.started && driver !== null && (!worker || state.consuming);
  return {
    status: ready ? "ok" : "degraded",
    checks: {
      configured: state.started,
      driver: driver?.kind ?? null,
      worker,
      consuming: state.consuming,
      jobs: definitions.length,
      schedules: definitions.filter((job) => job.schedule).length,
    },
  };
}

/**
 * Let in-flight jobs finish on a deploy. Deliberately does NOT call
 * process.exit — the host owns the shutdown, and cutting it short here would
 * kill the very requests we are draining for.
 *
 * The hook clears the instance state BEFORE the async drain: a drained worker
 * is no longer consuming, and the readiness probe must stop saying it is the
 * moment the drain begins — that flip is what tells a rolling deploy to stop
 * routing to this process.
 */
function installDrainHooks(logger: JobLogger, state: RuntimeState): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      state.consuming = false;
      state.started = false;
      void stopJobs().catch((error) => logger.error("shutdown failed:", error));
    });
  }
}

/**
 * The `start()` body: configure, register, and — in a worker — consume.
 *
 * `state.started` is set LAST on every successful path, so a throw anywhere
 * in here (a duplicate job name, a registration import that fails) leaves the
 * health endpoint degraded rather than reporting the half-configured runtime
 * as ok.
 */
async function startRuntime(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
  state: RuntimeState,
): Promise<void> {
  const { logger, worker } = resolved;
  const driver = await resolveDriver(config, resolved);
  if (!driver) {
    // Fail closed, by design: "no driver" is a completed start (future-pay's
    // bootstrapJobs returned normally here too). Health still reports it —
    // the driver check is null — so the probe sees what the log line said.
    state.started = true;
    return;
  }

  configureJobs({ driver, logger });

  // Registers every job. Must happen BEFORE `startJobWorkers`, which consumes
  // whatever is registered — a worker cannot consume a job it has never heard
  // of, and a producer cannot enqueue one.
  await registerJobs(config.jobs);

  if (!worker) {
    logger.info("producer mode: jobs will be enqueued, not consumed by this process.");
    state.started = true;
    return;
  }

  await startJobWorkers();
  state.consuming = true;

  if (config.installShutdownHooks ?? true) installDrainHooks(logger, state);
  state.started = true;
}

export function createApiJobs(config: JobsServerConfig): JobsApi {
  const resolved: ResolvedConfig = {
    redisUrl: config.redisUrl ?? process.env.REDIS_URL,
    production: config.production ?? process.env.NODE_ENV === "production",
    worker: config.worker ?? isWorkerProcess(),
    queuePrefix: config.queuePrefix ?? process.env.JOBS_QUEUE_PREFIX,
    logger: config.logger ?? consoleLogger,
  };
  const state: RuntimeState = { starting: false, started: false, consuming: false };

  return {
    routes: [
      {
        method: "GET",
        path: "/health",
        handle: async () => {
          const body = healthOf(state, resolved.worker);
          return { status: body.status === "ok" ? 200 : 503, body };
        },
      },
    ],

    async start(): Promise<void> {
      // The latch, not the success flag: a second call is a no-op, and a
      // start that threw is not silently retried — future-pay's bootstrapJobs
      // latched `bootstrapped` the same way. Success is `startRuntime`'s to
      // declare, as its last statement.
      if (state.starting) return;
      state.starting = true;
      await startRuntime(config, resolved, state);
    },

    async stop(): Promise<void> {
      await stopJobs();
      state.consuming = false;
      state.started = false;
      state.starting = false;
    },

    withSweepLease: bindSweepLease(config.db),
  };
}
