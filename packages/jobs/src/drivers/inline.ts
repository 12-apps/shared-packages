/**
 * The INLINE driver: run the handler in the calling process, immediately.
 *
 * For unit and integration tests (which must not need a queue backend running)
 * and for local development with no container. It is a real driver, not a stub
 * — `attempts` are honoured so retry behaviour stays testable — but three
 * things it deliberately does NOT do:
 *
 *   - **No delay.** `delayMs` is ignored and logged. A test asserting a
 *     three-day gap should assert on the enqueue, not on the clock.
 *   - **No schedules.** A cron job is registered but never fires; drive it
 *     directly in a test by calling the handler.
 *   - **No backoff waits.** Retries happen back-to-back so suites stay fast.
 *
 * Which is why it must never reach production: work would run inside the
 * request that scheduled it, and a crash between the two would lose it.
 * `createApiJobs` refuses it there, by name and by instance.
 *
 * It also does no registry lookup, so it has no write/run gate of its own to
 * keep in step: it runs the definition OBJECT it was handed, not a name it
 * resolves. `enqueueJob` applies the registry gate before the driver is
 * reached; a test calling `driver.enqueue(definition, …)` directly is
 * deliberately below that line.
 */

import type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  JobContext,
  JobDriver,
  JobEvents,
  JobLogger,
} from "../core/types";

import { createEventEmitter, type EmitJobEvent } from "../core/events";
import { DEFAULT_QUEUE } from "../core/queues";

export interface InlineJobDriverOptions {
  logger?: JobLogger;
  /**
   * Await the handler inside `enqueue` (the default) instead of letting it run
   * detached. Awaiting is what a test wants: the assertion after `enqueue`
   * sees the side effect.
   */
  await?: boolean;
  /**
   * Where completions and dead-letters are reported. The same port the BullMQ
   * driver takes, so a host's observer is exercised by its test suite instead
   * of only in production.
   */
  events?: JobEvents;
}

/** A record of what ran, for assertions. */
export interface InlineJobRun {
  name: string;
  payload: unknown;
  attempts: number;
  error?: unknown;
}

export interface InlineJobDriver extends JobDriver {
  /** Every run since the driver was created, in order. */
  readonly runs: readonly InlineJobRun[];
  /** Forget the recorded runs. */
  clearRuns(): void;
}

/** What one inline execution needs from the driver that owns it. */
interface InlineRunner {
  logger: JobLogger;
  runs: InlineJobRun[];
  emit: EmitJobEvent;
}

/**
 * Run one job to its conclusion, retrying up to `attempts` with no waits.
 *
 * Hoisted out of the factory so the factory stays a wiring function: the
 * attempt loop is the part with the rules in it, and it reads better with its
 * inputs named than closed over.
 */
async function runInline(
  runner: InlineRunner,
  definition: AnyJobDefinition,
  payload: unknown,
): Promise<void> {
  const { logger, runs, emit } = runner;
  const maxAttempts = Math.max(1, definition.attempts ?? 1);
  const queue = definition.queue ?? DEFAULT_QUEUE;
  const record: InlineJobRun = { name: definition.name, payload, attempts: 0 };
  runs.push(record);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    record.attempts = attempt;
    const runId = `inline:${definition.name}:${runs.length}:${attempt}`;
    const context: JobContext = { runId, attempt, maxAttempts, logger };
    const event = { name: definition.name, queue, runId, attempt, maxAttempts };
    try {
      await definition.handle(payload as never, context);
      record.error = undefined;
      emit((events) => events.onJobCompleted?.(event));
      return;
    } catch (error) {
      record.error = error;
      const terminal = attempt === maxAttempts;
      emit((events) => events.onJobFailed?.({ ...event, error, terminal }));
      if (terminal) {
        logger.error(`"${definition.name}" failed after ${attempt} attempt(s):`, error);
        return;
      }
    }
  }
}

export function createInlineJobDriver(
  options: InlineJobDriverOptions = {},
): InlineJobDriver {
  const logger = options.logger ?? console;
  const awaitHandlers = options.await ?? true;
  const runs: InlineJobRun[] = [];
  const runner: InlineRunner = {
    logger,
    runs,
    emit: createEventEmitter(options.events, logger),
  };

  return {
    kind: "inline",
    runs,
    clearRuns() {
      runs.length = 0;
    },
    async enqueue(
      definition: AnyJobDefinition,
      payload: unknown,
      enqueueOptions: EnqueueOptions,
    ): Promise<EnqueueResult> {
      if (enqueueOptions.delayMs) {
        logger.warn(
          `inline driver ignored a ${enqueueOptions.delayMs}ms delay on "${definition.name}".`,
        );
      }
      const execution = runInline(runner, definition, payload);
      if (awaitHandlers) await execution;
      else void execution;
      return { enqueued: true };
    },
    start(definitions: readonly AnyJobDefinition[]): Promise<void> {
      const scheduled = definitions.filter((job) => job.schedule);
      if (scheduled.length > 0) {
        logger.warn(
          `inline driver does not run schedules; ${scheduled.length} cron job(s) will never fire: ${scheduled
            .map((job) => job.name)
            .join(", ")}`,
        );
      }
      return Promise.resolve();
    },
    stop(): Promise<void> {
      return Promise.resolve();
    },
  };
}
