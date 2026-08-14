import type { RegisteredJob } from "../core/registry";
import type {
  JobDriver,
  JobEvents,
  JobLogger,
  JobRetention,
} from "../core/types";
import type { SweepLeaseDbProvider } from "../lease/sweep-lease";

/**
 * The factory's config surface, and how it resolves against the environment.
 *
 * Every environment read happens in {@link resolveConfig}, which `start()`
 * calls — NOT the factory. The whole matrix (`JOBS_DRIVER`, `REDIS_URL`,
 * `NODE_ENV`, `JOBS_WORKER`, `JOBS_QUEUE_PREFIX`) has to be read at ONE
 * moment, because the recommended host shape is factory-at-module-scope +
 * `await jobsApi.start()` later: an env var that arrives between the two (a
 * config module loading after the module that built the api) must be honoured
 * for all of the matrix, not silently for one variable and not the others.
 */

/** What the driver choice may say (`JOBS_DRIVER`, or `config.driver`). */
export type JobsDriverChoice = "bullmq" | "inline" | "off";

/**
 * How the host names its jobs. An import thunk (`() => import("./jobs")`) is
 * the usual form — `defineJob` registers at module scope, so importing the
 * modules IS the registration. An array of already-registered jobs is accepted
 * for hosts (and tests) that hold the references anyway; it forces the modules
 * to have been imported, which is the same guarantee.
 *
 * Neither form may be EMPTY. See {@link JobsConfigError}.
 */
export type JobsSource =
  | readonly RegisteredJob<never>[]
  | (() => unknown | Promise<unknown>);

/**
 * Raised at ASSEMBLY for a config that cannot work — today, a `jobs` that
 * names nothing.
 *
 * A required option that is never checked is still fail-open. `jobs: []` type-
 * checks, starts, resolves a driver, installs no schedule, consumes no queue
 * and answers `/health` with `status: "ok"` — every scheduled job in the
 * deployment silently stops and the probe stays green. Refusing at the factory
 * puts the failure at the line that wrote it.
 */
export class JobsConfigError extends Error {
  constructor(detail: string) {
    super(`createApiJobs: ${detail}`);
    this.name = "JobsConfigError";
  }
}

export interface JobsServerConfig {
  /**
   * Every job this process can enqueue or consume. See {@link JobsSource}.
   * Required, and refused when it names nothing.
   */
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
   * Where completions, dead-letters and removed schedules are reported. This
   * package never notifies, audits or publishes anything itself — it exports
   * the moment and the host wires the consequence.
   */
  events?: JobEvents;
  /**
   * How long finished jobs are kept. Defaults to the package's bounded
   * default (a day of successes, a week of failures).
   */
  retention?: JobRetention;
  /**
   * Per-queue worker concurrency when no job on the queue states one. A job
   * that states `concurrency: 1` still gets 1 — a stated value always wins.
   */
  defaultConcurrency?: number;
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

/**
 * Refuse a `jobs` that names nothing, at assembly.
 *
 * The array form is decidable here and is refused here. The thunk form is not
 * — running it is the only way to know what it registers — so it is checked
 * again after registration, inside `start()`. Both paths end at the same
 * refusal, which is why neither is optional.
 */
export function assertJobsDeclared(jobs: JobsSource | undefined): void {
  if (typeof jobs === "function") return;
  if (!Array.isArray(jobs)) {
    throw new JobsConfigError(
      "`jobs` is required — an import thunk (() => import('./jobs')) or a non-empty array of defineJob() results.",
    );
  }
  if (jobs.length === 0) {
    throw new JobsConfigError(
      "`jobs: []` declares no work. A process with no jobs consumes no queue, installs no " +
        "schedule and still reports itself healthy — pass the jobs, or do not mount this package.",
    );
  }
}

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
  events: JobEvents | undefined;
  retention: JobRetention | undefined;
  defaultConcurrency: number | undefined;
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
    events: config.events,
    retention: config.retention,
    defaultConcurrency: config.defaultConcurrency,
  };
}
