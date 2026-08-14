/**
 * The process-wide job runtime: which driver is installed, and the enqueue /
 * start / stop entry points that everything else goes through.
 *
 * A process is either a PRODUCER (the web server: it enqueues, it does not
 * consume), a CONSUMER (the worker: it does both), or neither (a unit test).
 * `configureJobs` installs the driver; `startJobWorkers` is the extra step a
 * consumer takes.
 *
 * This is a PUBLIC entry point, not merely `createApiJobs`'s plumbing: the
 * package root exports all of it, and a host that wires the runtime by hand
 * reaches every hazard the factory does. So the guards live HERE and the
 * factory inherits them, rather than the newest surface owning a second copy
 * the older path never got.
 */

import { assertJobsRegistered, listJobs, resolveRegisteredJob } from "./registry";
import type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  JobDriver,
  JobLogger,
} from "./types";

/** Fallback logger — used until the host installs its own. */
const consoleLogger: JobLogger = {
  info: (message, ...meta) => console.info(`[jobs] ${message}`, ...meta),
  warn: (message, ...meta) => console.warn(`[jobs] ${message}`, ...meta),
  error: (message, ...meta) => console.error(`[jobs] ${message}`, ...meta),
};

let driver: JobDriver | null = null;
let logger: JobLogger = consoleLogger;
let started = false;

/** Install the driver (and optionally the host's logger) for this process. */
export function configureJobs(options: {
  driver: JobDriver;
  logger?: JobLogger;
}): void {
  driver = options.driver;
  if (options.logger) logger = options.logger;
  logger.info(`runtime configured with the "${options.driver.kind}" driver`);
}

/** The installed driver, or `null` in a process that never configured one. */
export function getJobDriver(): JobDriver | null {
  return driver;
}

/** The logger the runtime and drivers write through. */
export function getJobLogger(): JobLogger {
  return logger;
}

/**
 * Defer one run of `definition`.
 *
 * **Never throws.** Every caller of this has just committed a durable row, and
 * the enqueue is only the fast path to acting on it. The backend being down
 * must degrade that to "a sweep will pick it up in a few minutes", not fail
 * the request that triggered it. The failure is logged loudly and reported in
 * the result for callers that care.
 *
 * It does REFUSE an unregistered definition, through the same
 * `resolveRegisteredJob` gate the execution side calls. Without that, a write
 * is accepted no worker can ever claim: the job lands in the backend, the
 * consumer finds no handler for the name, the run dead-letters, and the caller
 * was told `enqueued: true`. Refusing at the write is louder, and loses
 * nothing that was not already lost.
 */
export async function enqueueJob(
  definition: AnyJobDefinition,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  if (!resolveRegisteredJob(definition)) {
    logger.error(
      `"${definition.name}" was not enqueued: it is not the job registered under that ` +
        "name. Enqueue the value defineJob() returned, and import its module first.",
    );
    return { enqueued: false, reason: "unregistered" };
  }
  if (!driver) {
    logger.warn(
      `"${definition.name}" was not enqueued: no driver is configured in this process.`,
    );
    return { enqueued: false, reason: "no-driver" };
  }
  try {
    return await driver.enqueue(definition, payload, options);
  } catch (error) {
    logger.error(`enqueue of "${definition.name}" failed:`, error);
    return { enqueued: false, reason: "error" };
  }
}

/**
 * Start consuming every registered job and install their cron schedules.
 *
 * Idempotent: a second call is a no-op, so a bootstrap that runs twice cannot
 * double-consume.
 *
 * Refuses an EMPTY registry. A worker that consumes nothing is not a degraded
 * deployment but a broken one that looks fine: no queue is read, no schedule
 * is installed, and the process reports itself started. "The host declared no
 * jobs" and "the host's job modules were never imported" are the same fact
 * from here, and the second is the common one.
 */
export async function startJobWorkers(): Promise<void> {
  if (!driver) throw new Error("startJobWorkers(): no driver configured.");
  if (started) {
    logger.warn("startJobWorkers() called twice; ignoring the second call.");
    return;
  }
  assertJobsRegistered("startJobWorkers()");
  started = true;

  const definitions = listJobs();
  await driver.start(definitions);
  const scheduled = definitions.filter((job) => job.schedule).length;
  logger.info(
    `workers started: ${definitions.length} job(s), ${scheduled} on a schedule.`,
  );
}

/** Stop consuming and release the driver's connections. */
export async function stopJobs(): Promise<void> {
  if (!driver) return;
  await driver.stop();
  started = false;
  logger.info("workers stopped.");
}

/** Test-only: forget the installed driver and the started flag. */
export function resetJobRuntime(): void {
  driver = null;
  logger = consoleLogger;
  started = false;
}
