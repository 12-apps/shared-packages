import type { RegisteredJob } from "../core/registry";
import type { JobDriver, JobLogger } from "../core/types";
import type { SweepLeaseDbProvider } from "../lease/sweep-lease";

/**
 * The factory's config surface, and how it resolves against the environment.
 *
 * Every environment read happens in {@link resolveConfig}, which `start()`
 * calls — NOT the factory. future-pay's `bootstrapJobs()` read the whole
 * matrix (`JOBS_DRIVER`, `REDIS_URL`, `NODE_ENV`, `JOBS_WORKER`,
 * `JOBS_QUEUE_PREFIX`) at the moment it ran, and the recommended host shape
 * is factory-at-module-scope + `await jobsApi.start()` later — so an env var
 * that arrives between the two (a config module loading after the route
 * module) must be honoured for ALL of the matrix, not silently for one
 * variable and not the others.
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
   * Where the `sweep_leases` table lives — enables `withSweepLease` on the
   * factory's return. Omit it and the lease helper rejects on first use,
   * loudly, because a sweep that silently skipped its lease would be the
   * unprotected overlap the lease exists to prevent.
   */
  db?: SweepLeaseDbProvider;
  /**
   * Install `SIGTERM`/`SIGINT` handlers that drain in-flight jobs on a deploy
   * (worker processes only). Defaults to true; turn it off in tests, which
   * must not leak process listeners.
   */
  installShutdownHooks?: boolean;
}

/** Fallback logger — used until the host passes its own. */
const consoleLogger: JobLogger = {
  info: (message, ...meta) => console.info(`[jobs] ${message}`, ...meta),
  warn: (message, ...meta) => console.warn(`[jobs] ${message}`, ...meta),
  error: (message, ...meta) => console.error(`[jobs] ${message}`, ...meta),
};

/** `JOBS_WORKER=1|true` is how a deployment marks the consuming process. */
export function isWorkerProcess(): boolean {
  const flag = process.env.JOBS_WORKER?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/** The config with every environment default applied, at one single moment. */
export interface ResolvedConfig {
  redisUrl: string | undefined;
  production: boolean;
  worker: boolean;
  queuePrefix: string | undefined;
  logger: JobLogger;
}

/**
 * Apply the environment defaults. Called from `start()` so the whole matrix
 * is read at the same moment — the factory reads nothing, and `JOBS_DRIVER`
 * (read during driver resolution, also under `start()`) cannot disagree with
 * `REDIS_URL` about WHEN the environment was consulted.
 */
export function resolveConfig(config: JobsServerConfig): ResolvedConfig {
  return {
    redisUrl: config.redisUrl ?? process.env.REDIS_URL,
    production: config.production ?? process.env.NODE_ENV === "production",
    worker: config.worker ?? isWorkerProcess(),
    queuePrefix: config.queuePrefix ?? process.env.JOBS_QUEUE_PREFIX,
    logger: config.logger ?? consoleLogger,
  };
}
