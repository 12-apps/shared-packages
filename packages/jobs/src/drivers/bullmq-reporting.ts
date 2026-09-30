import type { Job } from "bullmq";

import type { EmitJobEvent } from "../core/events";
import type { JobLogger } from "../core/types";

import { isTerminalFailure } from "./bullmq-policy";

/**
 * What the BullMQ driver says when a job goes wrong: one ERROR line per failed
 * attempt and per stall, each naming the job, its run and its attempt, plus
 * the matching `JobEvents` hook for the host.
 *
 * Every failure gets its own line on purpose. A host's logger is usually its
 * error reporter too, and a failure that is only counted, or only reported
 * when it is the last one, leaves nothing to investigate when the pattern is
 * the problem: a job that fails twice a day and succeeds on retry, or a
 * worker that stalls every night and recovers.
 */
interface ReportingState {
  logger: JobLogger;
  emit: EmitJobEvent;
}

/** The fields of a BullMQ job a failure report reads. */
type FailedJob = Pick<Job, "name" | "id" | "attemptsMade" | "opts">;

/** Report one failed attempt, and `onJobFailed` with whether it was the last. */
export function reportFailure(
  state: ReportingState,
  queueName: string,
  job: FailedJob | undefined,
  error: unknown,
): void {
  if (!job) {
    // BullMQ passes no job when the failure is not tied to one it can read.
    state.logger.error(`a job on queue "${queueName}" failed (run ?):`, error);
    return;
  }
  const maxAttempts = job.opts.attempts ?? 1;
  const terminal = isTerminalFailure(job.attemptsMade, maxAttempts, error);
  const runId = job.id ?? `${job.name}:unknown`;
  // The outcome is stated rather than left to be inferred from the attempt
  // count: a stall-limit or no-handler failure is terminal on attempt 1 of 3.
  state.logger.error(
    `job "${job.name}" failed (run ${runId}, attempt ${job.attemptsMade}/${maxAttempts}, ` +
      `${terminal ? "no retry left" : "will retry"}):`,
    error,
  );
  state.emit((events) =>
    events.onJobFailed?.({
      name: job.name,
      queue: queueName,
      runId,
      attempt: job.attemptsMade,
      maxAttempts,
      error,
      terminal,
    }),
  );
}

/** The fields of a BullMQ job a stall report reads. */
type StalledJob = Pick<
  Job,
  "name" | "attemptsStarted" | "stalledCounter" | "opts" | "repeatJobKey"
>;

/** Read the stalled job back; a failed read is `undefined`, never a throw. */
async function readStalledJob(
  getJob: (id: string) => Promise<StalledJob | undefined>,
  jobId: string,
): Promise<StalledJob | undefined> {
  try {
    return await getJob(jobId);
  } catch {
    return undefined;
  }
}

/** What the stall report says happens next. */
function nextAfterStall(job: StalledJob | undefined, maxStalledCount: number): string {
  const stalledCount = job?.stalledCounter ?? 0;
  if (job && !job.repeatJobKey && stalledCount > maxStalledCount) {
    return `it has stalled more than the ${maxStalledCount} time(s) allowed, so it is failed as a dead-letter.`;
  }
  return "it was moved back to wait and will run again.";
}

/**
 * Report one stalled job, and `onJobStalled`.
 *
 * BullMQ's `stalled` event carries only the id, so the job is read back for
 * its name and counters. That read is best-effort: a job already trimmed, or a
 * Redis that did not answer, still produces the line, with the id alone.
 *
 * The line says what happens next. A job over its stall budget is failed as a
 * dead-letter rather than re-run, except a scheduled one: BullMQ never applies
 * `maxStalledCount` to those, and they are bounded by `maxStartedAttempts`
 * when they next start instead.
 */
export async function reportStall(
  state: ReportingState,
  queueName: string,
  jobId: string,
  getJob: (id: string) => Promise<StalledJob | undefined>,
  maxStalledCount: number,
): Promise<void> {
  const job = await readStalledJob(getJob, jobId);
  const maxAttempts = job?.opts.attempts ?? 1;
  const startedCount = job?.attemptsStarted ?? 0;
  const stalledCount = job?.stalledCounter ?? 0;
  state.logger.error(
    `job "${job?.name ?? "?"}" on queue "${queueName}" stalled (run ${jobId}, ` +
      `started ${startedCount} time(s) of ${maxAttempts} attempt(s), stalled ${stalledCount} ` +
      `time(s)): its lock expired before it finished; ${nextAfterStall(job, maxStalledCount)}`,
  );
  state.emit((events) =>
    events.onJobStalled?.({
      name: job?.name,
      queue: queueName,
      runId: jobId,
      startedCount,
      maxAttempts,
      stalledCount,
    }),
  );
}
