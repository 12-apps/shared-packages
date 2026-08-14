/**
 * Core types of the background-job library.
 *
 * Three layers, each replaceable without touching the others:
 *   - DEFINITIONS describe a unit of deferred work: its name, its retry
 *     policy, its optional cron schedule, and the handler that runs it.
 *   - The REGISTRY collects definitions at import time so a worker process can
 *     start every job by importing the modules that define them.
 *   - A DRIVER executes them. BullMQ/Redis in production, inline in tests.
 *
 * Nothing here imports Redis, an ORM, or an application's domain. A job
 * handler receives a plain payload and is expected to re-read whatever it
 * needs from the database — see the payload rule below.
 */

/**
 * The logging port. Structurally satisfied by a winston-style logger and by
 * `console`, so the library needs no logging dependency of its own.
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
  /**
   * Standard 5-field cron expression (a 6-field form carrying seconds is
   * accepted too). Validated when the job is defined: a blank or malformed
   * pattern installs a scheduler that never fires, which is a sweep that
   * silently never runs.
   */
  pattern: string;
  /**
   * IANA timezone the pattern is evaluated in. Defaults to UTC — a schedule
   * that means "03:00 local" must say WHICH local, because a server's own zone
   * is not a product decision.
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
 * A payload carries IDENTIFIERS, never state. `{ documentId }`, not the
 * rendered document; `{ accountId, periodStart }`, not the amount to charge.
 * Two reasons, and both are load-bearing:
 *
 *   1. **The queue is not the source of truth.** The database is. A payload
 *      that duplicates a row's contents is a second copy that can disagree
 *      with it — and the copy is the one that gets acted on, days later, after
 *      the row changed. Re-reading inside the handler is always correct.
 *   2. **The queue can be lost.** A flushed or evicted backend must cost a
 *      delayed run, not a lost or corrupted business fact. Pair every job with
 *      a durable row a sweep can find again.
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
   * Which queue carries it. One queue (`DEFAULT_QUEUE`) for everything is the
   * right shape at most scales — one worker, one pair of connections, one
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
   * caller — `<job>:<entity id>`, or `<job>:<entity id>:<date>` for a job that
   * may legitimately repeat daily.
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

/**
 * Why an enqueue did not reach a queue.
 *
 * `unregistered` is the one that is a PROGRAMMING error rather than an
 * operational one: the definition handed in is not the one the registry holds
 * under that name, so no worker in this deployment could ever run it. See
 * `enqueueJob`.
 */
export type EnqueueSkipReason = "no-driver" | "duplicate" | "error" | "unregistered";

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

/** What happened to one attempt of one job. */
export interface JobRunEvent {
  name: string;
  /** The queue that carried it, already resolved — never `undefined`. */
  queue: string;
  /** The driver's id for the run, matching {@link JobContext.runId}. */
  runId: string;
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
}

/** A job that finished successfully. */
export type JobCompletedEvent = JobRunEvent;

/** A job attempt that threw. */
export interface JobFailedEvent extends JobRunEvent {
  error: unknown;
  /**
   * No further attempt will be made — the attempt budget is spent, or the
   * failure was unrecoverable. This is the DEAD-LETTER signal, and the one
   * moment a host may want to notify someone, open a ticket or page an
   * operator. A non-terminal failure is ordinary retry noise.
   */
  terminal: boolean;
}

/** A cron schedule that existed in the backend and no longer exists in code. */
export interface ScheduleRemovedEvent {
  /** The scheduler key, which is the name of the job that installed it. */
  name: string;
  queue: string;
}

/**
 * The observation port — how the rest of a system finds out what the queue did.
 *
 * This package deliberately does NOT notify, audit or publish anything itself:
 * it has no opinion about who should hear that a job dead-lettered, and
 * reaching for a notification package here would make every host inherit that
 * opinion (and that dependency). What it owns is the MOMENT, so the moment is
 * exported and the host wires the consequence.
 *
 * Every hook is optional, and a hook that throws is logged and swallowed — an
 * observer must never fail the job it is observing, nor the reconcile that
 * removed a stale schedule.
 */
export interface JobEvents {
  /** A job finished successfully. The seam for a realtime "it is done" event. */
  onJobCompleted?(event: JobCompletedEvent): void | Promise<void>;
  /**
   * An attempt failed. Check `terminal` — that is the dead-letter, and the
   * only one of the two most hosts want to act on.
   */
  onJobFailed?(event: JobFailedEvent): void | Promise<void>;
  /**
   * A schedule was removed from the backend because no code declares it any
   * more. Destructive and unrecoverable from the queue's side, which is why it
   * is the schedule event worth auditing; installation is an idempotent upsert
   * that happens on every boot, so auditing that would write noise per deploy.
   */
  onScheduleRemoved?(event: ScheduleRemovedEvent): void | Promise<void>;
}

/** How long finished jobs are kept in the backend before they are trimmed. */
export interface JobRetentionWindow {
  ageSeconds: number;
  count: number;
}

/**
 * Retention for finished jobs. Bounded on purpose: an unbounded completed-set
 * is the classic way a small queue backend fills up and starts refusing
 * writes. The package default keeps a day of successes (enough to answer "did
 * it run?") and a week of failures (enough to debug one); a host whose support
 * window is longer says so rather than forking the driver.
 */
export interface JobRetention {
  completed: JobRetentionWindow;
  failed: JobRetentionWindow;
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
