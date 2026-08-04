/**
 * The INLINE driver: run the handler in the calling process, immediately.
 *
 * For unit and integration tests (which boot PGlite and must not need a Redis
 * container) and for local development without `docker compose up`. It is a
 * real driver, not a stub — `attempts` are honoured so retry behaviour stays
 * testable — but three things it deliberately does NOT do:
 *
 *   - **No delay.** `delayMs` is ignored and logged. A test asserting a
 *     three-day dunning gap should assert on the enqueue, not the clock.
 *   - **No schedules.** A cron job is registered but never fires; drive it
 *     directly in a test by calling the handler.
 *   - **No backoff waits.** Retries happen back-to-back so suites stay fast.
 *
 * Which is why it must never reach production: work would run inside the
 * request that scheduled it, and a crash between the two would lose it. The
 * host's driver factory is responsible for refusing it there.
 */

import type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  JobContext,
  JobDriver,
  JobLogger,
} from "../core/types";

export interface InlineJobDriverOptions {
  logger?: JobLogger;
  /**
   * Await the handler inside `enqueue` (the default) instead of letting it run
   * detached. Awaiting is what a test wants: the assertion after `enqueue`
   * sees the side effect.
   */
  await?: boolean;
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

export function createInlineJobDriver(
  options: InlineJobDriverOptions = {},
): InlineJobDriver {
  const logger = options.logger ?? console;
  const awaitHandlers = options.await ?? true;
  const runs: InlineJobRun[] = [];

  async function run(
    definition: AnyJobDefinition,
    payload: unknown,
  ): Promise<void> {
    const maxAttempts = Math.max(1, definition.attempts ?? 1);
    const record: InlineJobRun = { name: definition.name, payload, attempts: 0 };
    runs.push(record);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      record.attempts = attempt;
      const context: JobContext = {
        runId: `inline:${definition.name}:${runs.length}:${attempt}`,
        attempt,
        maxAttempts,
        logger,
      };
      try {
        await definition.handle(payload as never, context);
        record.error = undefined;
        return;
      } catch (error) {
        record.error = error;
        if (attempt === maxAttempts) {
          logger.error(
            `"${definition.name}" failed after ${attempt} attempt(s):`,
            error,
          );
          return;
        }
      }
    }
  }

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
      const execution = run(definition, payload);
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
