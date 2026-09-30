import { UnrecoverableError, type JobsOptions } from "bullmq";

import { assertValidRetention } from "../core/retention";
import type { AnyJobDefinition, JobRetention, JobStallPolicy } from "../core/types";

/**
 * The BullMQ driver's three policy decisions, kept together and out of the
 * driver body — retention, concurrency and what counts as a dead-letter.
 *
 * All three share a property that makes them worth their own file and their
 * own tests: each is SILENT when it is wrong. Nothing throws, no probe turns
 * red, and the only symptom is behaviour nobody is watching — a queue that
 * filled up, a sweep that quietly stopped being single-flight, a pager that
 * never went off.
 */

/** Worker concurrency when no definition on the queue asks for a specific one. */
export const DEFAULT_CONCURRENCY = 5;

/**
 * The package's retention default: a day of successes is enough to answer "did
 * it run?", a week of failures is enough to debug one. Bounded on purpose — an
 * unbounded completed-set is the classic way a small Redis fills up and starts
 * refusing writes. A host with a different support window passes its own
 * {@link JobRetention} rather than forking the driver.
 */
export const DEFAULT_JOB_RETENTION: JobRetention = {
  completed: { ageSeconds: 24 * 3600, count: 1_000 },
  failed: { ageSeconds: 7 * 24 * 3600, count: 5_000 },
};

/**
 * Validated HERE, at the single funnel both paths cross, rather than only at
 * the server factory: `@12-apps/jobs/bullmq` is a published entry point, so a
 * host that builds the driver itself would otherwise reach BullMQ with an
 * unchecked window. `createApiJobs` checks the same thing at assembly so the
 * failure lands on the line that wrote it, and this is the backstop that makes
 * the check a property of the driver rather than of the newest caller.
 */
export function retentionOptions(
  retention: JobRetention,
): Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> {
  assertValidRetention(retention);
  return {
    removeOnComplete: {
      age: retention.completed.ageSeconds,
      count: retention.completed.count,
    },
    removeOnFail: { age: retention.failed.ageSeconds, count: retention.failed.count },
  };
}

/**
 * A queue's worker concurrency.
 *
 * The default applies only when NO definition on the queue asked for a
 * specific number. A stated `concurrency: 1` means single-flight and must be
 * honoured — taking `max(default, …)` would quietly raise it back to the
 * default and undo the very property the caller asked for.
 */
export function resolveConcurrency(
  group: readonly AnyJobDefinition[],
  fallback: number = DEFAULT_CONCURRENCY,
): number {
  const stated = group
    .map((definition) => definition.concurrency)
    .filter((value): value is number => typeof value === "number" && value > 0);
  return stated.length > 0 ? Math.max(...stated) : fallback;
}

/**
 * Is this the last thing that will happen to the job?
 *
 * The whole value of `onJobFailed` rests on this bit: a host pages someone on
 * a dead-letter and must not page them on every retry. Two ways to be
 * terminal — the attempt budget is spent, or the failure was declared
 * unrecoverable (a name no handler claims is the common one, and BullMQ never
 * retries it).
 */
export function isTerminalFailure(
  attemptsMade: number,
  maxAttempts: number,
  error: unknown,
): boolean {
  return attemptsMade >= maxAttempts || error instanceof UnrecoverableError;
}

/**
 * The most times one run of a job may be STARTED on this queue before the
 * worker fails it as a dead-letter: every attempt it is allowed,
 * plus every stall it is allowed to recover from.
 *
 * This is the only bound a SCHEDULED job has. BullMQ never applies
 * `maxStalledCount` to a job-scheduler job (`moveStalledJobsToWait`'s
 * `isRepeatableJob` branch), so a tick whose handler takes the worker down
 * every time it runs, a poison pill, would otherwise be put back and started
 * again forever, taking every other job on the queue down with it. With the
 * cap, the start that goes over it is failed as unrecoverable, reaches the
 * failed set and `onJobFailed` with `terminal: true`, and the next tick of the
 * schedule is a fresh job with its own budget.
 *
 * Worker-wide, so it takes the largest attempt budget on the queue: a cap
 * below one job's legitimate retries would dead-letter it early.
 */
export function maxStartedAttemptsFor(
  group: readonly AnyJobDefinition[],
  maxStalledCount: number,
): number {
  const attempts = group.map((definition) => Math.max(1, definition.attempts ?? 1));
  return Math.max(1, ...attempts) + maxStalledCount;
}

/**
 * A queue's lock and stall settings, in BullMQ's option names. Spelled out
 * rather than left to BullMQ's defaults: the numbers a stall is judged by
 * belong where the host can read and configure them.
 */
export function workerStallOptions(
  group: readonly AnyJobDefinition[],
  stall: JobStallPolicy,
): {
  lockDuration: number;
  stalledInterval: number;
  maxStalledCount: number;
  maxStartedAttempts: number;
} {
  return {
    lockDuration: stall.lockDurationMs,
    stalledInterval: stall.stalledIntervalMs,
    maxStalledCount: stall.maxStalledCount,
    maxStartedAttempts: maxStartedAttemptsFor(group, stall.maxStalledCount),
  };
}
