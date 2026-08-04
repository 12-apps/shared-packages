/**
 * Core types of the background-job library.
 *
 * Three layers, each replaceable without touching the others:
 *   - DEFINITIONS describe a unit of deferred work: its name, its retry
 *     policy, its optional cron schedule, and the handler that runs it.
 *   - The REGISTRY collects definitions at import time (the same open/closed
 *     seam the notification generators use) so a worker process can start
 *     every job by importing the modules that define them.
 *   - A DRIVER executes them. BullMQ/Redis in production, inline in tests.
 *
 * Nothing here imports Redis, Prisma, or the host app. A job handler receives
 * a plain payload and is expected to re-read whatever it needs from the
 * database — see the payload rule below.
 */

/**
 * The logging port. Structurally satisfied by a winston logger (what the host
 * app has) and by `console` (what a test wants), so the library needs no
 * logging dependency of its own.
 */
export interface JobLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/** Retry spacing after a failed attempt. */
export interface JobBackoff {
  /**
   * `exponential` doubles `delayMs` per attempt (5s → 10s → 20s → …), which is
   * what a flaky provider call wants. `fixed` waits `delayMs` every time.
   */
  type: "exponential" | "fixed";
  delayMs: number;
}

/** A cron schedule for a repeatable job. */
export interface JobSchedule {
  /** Standard 5-field cron expression. */
  pattern: string;
  /**
   * IANA timezone the pattern is evaluated in. Defaults to UTC — a schedule
   * that means "03:00 in São Paulo" must say so, because a server's local
   * zone is not a product decision.
   */
  timezone?: string;
}

/** What a handler is told about the attempt it is running in. */
export interface JobContext {
  /** The driver's id for this run. Useful in logs; never a business key. */
  runId: string;
  /** 1-based. `attempt === maxAttempts` means this is the last chance. */
  attempt: number;
  maxAttempts: number;
  logger: JobLogger;
}

/** The unit of work itself. Throwing schedules a retry; returning succeeds. */
export type JobHandler<TPayload> = (
  payload: TPayload,
  context: JobContext,
) => Promise<void>;

/**
 * A job's declaration.
 *
 * ## The payload rule
 *
 * A payload carries IDENTIFIERS, never state. `{ notificationId }`, not the
 * rendered e-mail; `{ subscriptionId, periodStart }`, not the amount to
 * charge. Two reasons, and both are load-bearing:
 *
 *   1. **Redis is not the source of truth.** The database is. A payload that
 *      duplicates a row's contents is a second copy that can disagree with it
 *      — and the copy is the one that gets acted on, days later, after the row
 *      changed. Re-reading inside the handler is always correct.
 *   2. **Redis can be lost.** A flushed or evicted queue must cost a delayed
 *      run, not a lost or corrupted business fact. Every job here is paired
 *      with a durable row that a sweep can find again.
 *
 * ## Idempotency
 *
 * At-least-once delivery is the contract. A handler MUST tolerate running
 * twice on the same payload — the driver can redeliver after a worker dies
 * between the side effect and the acknowledgement, and a retry after a
 * timeout may race the original. Lean on the database's unique constraints
 * for this, not on the queue.
 */
export interface JobDefinition<TPayload = void> {
  /** Dot-namespaced and stable: it is the wire key and the scheduler id. */
  name: string;
  /**
   * Which queue carries it. One queue ("default") for everything is the right
   * shape at this scale — one worker, one pair of Redis connections, one
   * dashboard. Move a noisy or slow job onto its own queue when it starts
   * starving the others; no call site changes when you do.
   */
  queue?: string;
  /** Total attempts including the first. Defaults to 1 (no retry). */
  attempts?: number;
  backoff?: JobBackoff;
  /** Present ⇒ the job also runs on a schedule, with no payload. */
  schedule?: JobSchedule;
  /**
   * Per-queue worker concurrency. Set it on any job in the queue; the highest
   * STATED value wins, and the driver's default applies only when no job on
   * the queue states one — so `concurrency: 1` really does mean single-flight
   * rather than being raised back to the default.
   */
  concurrency?: number;
  handle: JobHandler<TPayload>;
}

/** A definition with its payload type erased — what registries and drivers hold. */
export type AnyJobDefinition = JobDefinition<never>;

/** Per-enqueue overrides. */
export interface EnqueueOptions {
  /**
   * Collapses duplicates: while a job with this key is waiting, delayed or
   * active, enqueueing it again is a no-op. Scope it to the work, not the
   * caller — `notification:<id>`, `low-stock:<itemId>:<date>`.
   *
   * NOT a durability mechanism. The key is forgotten once the job completes
   * and is cleaned up, so it stops accidental double-sends within a window,
   * not double-processing across days. Business idempotency stays in the
   * database.
   */
  dedupeKey?: string;
  /** Run no earlier than this many milliseconds from now. */
  delayMs?: number;
}

/** Why an enqueue did not reach a queue. */
export type EnqueueSkipReason = "no-driver" | "duplicate" | "error";

/**
 * The result of an enqueue.
 *
 * Enqueueing NEVER throws (see `enqueueJob`): a queue outage must not take
 * down the request that was merely trying to defer some work. The caller has
 * already committed the durable row; a sweep will find it.
 */
export interface EnqueueResult {
  enqueued: boolean;
  reason?: EnqueueSkipReason;
}

/**
 * The driver port. `inline` and `bullmq` implement it; a third (SQS, pg-boss)
 * would need no change above this line.
 */
export interface JobDriver {
  readonly kind: string;
  /** Hand one unit of work to the backend. Throws only on a real backend fault. */
  enqueue(
    definition: AnyJobDefinition,
    payload: unknown,
    options: EnqueueOptions,
  ): Promise<EnqueueResult>;
  /**
   * Begin consuming, and install the cron schedules of every definition that
   * declares one. Idempotent: calling it twice must not double-consume or
   * duplicate a schedule.
   */
  start(definitions: readonly AnyJobDefinition[]): Promise<void>;
  /** Stop consuming and release connections, letting in-flight jobs finish. */
  stop(): Promise<void>;
}
