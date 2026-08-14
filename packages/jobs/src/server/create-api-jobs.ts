import { assertJobsRegistered, listJobs } from "../core/registry";
import { assertValidRetention } from "../core/retention";
import {
  configureJobs,
  getJobDriver,
  startJobWorkers,
  stopJobs,
} from "../core/runtime";
import type { JobLogger } from "../core/types";
import {
  createSweepLease,
  type SweepLeaseDbProvider,
  type WithSweepLease,
} from "../lease/sweep-lease";

import {
  assertJobsDeclared,
  isWorkerProcess,
  resolveConfig,
  type JobsServerConfig,
  type JobsSource,
  type ResolvedConfig,
} from "./config";
import { resolveDriver } from "./resolve-driver";

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
 *
 * ## `jobs` is refused when it names nothing
 *
 * "Fail closed, never fail loud" is about the QUEUE. It does not extend to the
 * wiring: `jobs: []`, or a thunk that registers nothing because its import was
 * dropped, produces a process that resolves a driver, consumes no queue,
 * installs no schedule and answers `/health` with `ok`. Every scheduled job in
 * the deployment stops and nothing reports it. So an empty `jobs` throws — at
 * the factory for the array form, and after registration for the thunk form.
 *
 * ## The environment is read at `start()`, not at the factory
 *
 * The recommended host shape is factory-at-module-scope + `await
 * jobsApi.start()` at process start. Reading part of the matrix at factory
 * time would honour a late-arriving `JOBS_DRIVER` and silently ignore a
 * late-arriving `REDIS_URL` (a host whose config module loads after the module
 * that built the api), so the factory reads nothing and `start()` resolves
 * everything at one single moment.
 */

/** What a route handler answers; the host maps it onto its response type. */
export interface JobsResponse {
  status: number;
  body: unknown;
}

/** A framework-neutral route descriptor. */
export interface JobsRoute {
  method: "GET";
  /** Path relative to the host's jobs mount, e.g. `/health`. */
  path: string;
  handle(): Promise<JobsResponse>;
}

/**
 * The health payload `GET /health` answers with.
 *
 * Three states, two status codes: `ok` (200) is a working runtime; `disabled`
 * (200) is an EXPLICIT `off` — `JOBS_DRIVER=off` or
 * `createApiJobs({ driver: "off" })` — OUTSIDE production: a review box or CI
 * that genuinely wants no queue, which must not fail a readiness aggregate
 * forever; `degraded` (503) is everything that is wrong rather than chosen —
 * a misconfiguration, a failed start, a drained worker, and any production
 * with no queue, spelled out or not (production never deliberately wants
 * none).
 */
export interface JobsHealth {
  status: "ok" | "degraded" | "disabled";
  checks: {
    /**
     * `start()` has completed WITHOUT THROWING in this process. A start that
     * rejected (a duplicate job name, a failing registration import) leaves
     * this false and the status degraded — a failed boot must never probe
     * green.
     */
    configured: boolean;
    /**
     * The resolved driver's kind, or null when jobs are disabled. Reads the
     * process-wide runtime: with two `createApiJobs` instances in one process
     * (never a real host's shape) each reports whichever driver was
     * configured last.
     */
    driver: string | null;
    /**
     * Whether this process is meant to consume, not just enqueue.
     * Provisional until `start()` has run: before then it is a best-effort
     * read of `config.worker` / `JOBS_WORKER` at probe time (pre-start health
     * is degraded regardless, so nothing is decided from it).
     */
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
   * `start()` has been ENTERED — the idempotency latch: a second call is a
   * no-op, and a start that threw is not retried by calling it again.
   */
  starting: boolean;
  /**
   * `start()` has COMPLETED without throwing — the success flag health keys
   * on. Kept separate from `starting` because a start that rejected must
   * leave the probe red, not report the half-configured runtime as ok.
   */
  started: boolean;
  consuming: boolean;
  /** Resolution chose "no driver" because it was TOLD to — see {@link JobsHealth}. */
  deliberatelyOff: boolean;
  /**
   * The drain hooks have been installed — once per instance, ever. A
   * stop()/start() cycle must not stack a second `process.once` pair, or one
   * real signal would drain the driver twice.
   */
  hooksInstalled: boolean;
  /**
   * The env-resolved config, cached by `start()`. Null until then: the
   * factory deliberately reads no environment (see the module header), so a
   * pre-start health probe falls back to reading the worker switch at handle
   * time.
   */
  resolved: ResolvedConfig | null;
}

/** "disabled" is a choice, "ok" is a working runtime, "degraded" is a fault. */
function statusOf(
  state: RuntimeState,
  driverKind: string | null,
  worker: boolean,
): JobsHealth["status"] {
  if (state.started && state.deliberatelyOff) return "disabled";
  const ready = state.started && driverKind !== null && (!worker || state.consuming);
  return ready ? "ok" : "degraded";
}

function healthOf(config: JobsServerConfig, state: RuntimeState): JobsHealth {
  const definitions = listJobs();
  const driver = getJobDriver()?.kind ?? null;
  const worker = state.resolved
    ? state.resolved.worker
    : (config.worker ?? isWorkerProcess());
  return {
    status: statusOf(state, driver, worker),
    checks: {
      configured: state.started,
      driver,
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
  // A stop() that lands while start() is awaiting wins: `stop()` clears
  // `starting`, and each publish point below re-checks it — otherwise the
  // start's continuation would set consuming/started AFTER the stop and a
  // stopped runtime would advertise itself as a healthy consumer (the same
  // untruth the drain-hook fix closed, one window narrower).
  const stopped = (): boolean => !state.starting;

  const { driver, deliberatelyOff } = await resolveDriver(config, resolved);
  if (stopped()) return;
  state.deliberatelyOff = deliberatelyOff;
  if (!driver) {
    // Fail closed, by design: "no driver" is a completed start. Health still
    // reports it — the driver check is null — so the probe sees what the log
    // line said. Registration is deliberately skipped: a process with jobs
    // disabled must not install seams whose enqueues would all report
    // `no-driver`.
    state.started = true;
    return;
  }

  configureJobs({ driver, logger });

  // Registers every job. Must happen BEFORE `startJobWorkers`, which consumes
  // whatever is registered — a worker cannot consume a job it has never heard
  // of, and a producer cannot enqueue one.
  await registerJobs(config.jobs);
  // The thunk form's half of the empty-`jobs` refusal (the array form was
  // refused at the factory). It runs for BOTH roles: a producer that
  // registered nothing enqueues nothing, which is the same silent stop as a
  // worker that consumes nothing.
  assertJobsRegistered("createApiJobs().start()");
  if (stopped()) return;

  if (!worker) {
    logger.info("producer mode: jobs will be enqueued, not consumed by this process.");
    state.started = true;
    return;
  }

  await startJobWorkers();
  if (stopped()) return;
  state.consuming = true;

  if ((config.installShutdownHooks ?? true) && !state.hooksInstalled) {
    installDrainHooks(logger, state);
    state.hooksInstalled = true;
  }
  state.started = true;
}

export function createApiJobs(config: JobsServerConfig): JobsApi {
  // At ASSEMBLY, before anything else: a `jobs` that names nothing is a wiring
  // error, and the factory is where the stack trace still points at the host
  // module that wrote it.
  assertJobsDeclared(config?.jobs);
  // The same class of failure, one knob over: a retention window that is NaN
  // or negative does not shrink retention, it stops bounding the backend at
  // all — silently, weeks before anyone notices. The driver re-checks it, for
  // a host that builds one directly off `@12-apps/jobs/bullmq`.
  assertValidRetention(config?.retention);

  const state: RuntimeState = {
    starting: false,
    started: false,
    consuming: false,
    deliberatelyOff: false,
    hooksInstalled: false,
    resolved: null,
  };

  return {
    routes: [
      {
        method: "GET",
        path: "/health",
        handle: async () => {
          const body = healthOf(config, state);
          // Only "degraded" is a failure; "disabled" is a choice and must not
          // fail a readiness aggregate forever.
          return { status: body.status === "degraded" ? 503 : 200, body };
        },
      },
    ],

    async start(): Promise<void> {
      // The latch, not the success flag: a second call is a no-op, and a
      // start that threw is not silently retried. Success is `startRuntime`'s
      // to declare, as its last statement.
      if (state.starting) return;
      state.starting = true;
      // The whole env matrix is read HERE, at the same moment the driver
      // choice reads JOBS_DRIVER — never at factory time.
      state.resolved = resolveConfig(config);
      await startRuntime(config, state.resolved, state);
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
