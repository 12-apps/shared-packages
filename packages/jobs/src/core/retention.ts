import type { JobRetention, JobRetentionWindow } from "./types";

/**
 * Validation for the retention window a host may now configure.
 *
 * It lives in `core` rather than beside the BullMQ driver that consumes it so
 * that the root entry point can re-export the error without dragging `bullmq`
 * — and therefore ioredis — into a bundle that only ever enqueues. Nothing
 * here imports a driver; it is arithmetic on four numbers.
 */

/**
 * Raised for a retention window that cannot bound anything.
 *
 * The negative case is the one worth the class. BullMQ's count trim runs
 * `ZREMRANGEBYRANK` derived from the number it is given, so a NEGATIVE count
 * removes one job per completion instead of holding the set at a ceiling —
 * which is not "less retention", it is the UNBOUNDED completed-set that the
 * default exists to prevent, arrived at by way of a config knob. Nothing
 * throws, no probe reddens, and the symptom is a Redis that fills up weeks
 * later and starts refusing writes.
 *
 * `NaN` is the likelier way in: `ageSeconds: Number(process.env.JOBS_KEEP_H)`
 * with the variable unset is `NaN`, which every comparison in the trim silently
 * answers false for.
 */
export class InvalidJobRetentionError extends Error {
  constructor(field: string, value: unknown) {
    super(
      `retention.${field} must be a positive finite number, got ${JSON.stringify(value)}. ` +
        "A non-positive or NaN window does not shrink retention — it stops bounding the set.",
    );
    this.name = "InvalidJobRetentionError";
  }
}

function assertWindow(half: string, window: JobRetentionWindow | undefined): void {
  if (typeof window !== "object" || window === null) {
    throw new InvalidJobRetentionError(half, window);
  }
  for (const field of ["ageSeconds", "count"] as const) {
    const value = window[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new InvalidJobRetentionError(`${half}.${field}`, value);
    }
  }
}

/**
 * Refuse a retention that cannot bound the backend.
 *
 * Held to the same standard as every sibling numeric input — `attempts` and
 * `concurrency` go through `assertPositiveInteger`, `backoff.delayMs` through
 * a finite check, and the driver's `defaultConcurrency` is sanitised with a
 * `> 0` guard. Retention was the one configurable number with no check on any
 * path, and it is the only one whose failure is invisible.
 *
 * `undefined` is fine and means "use the package default"; it is the values a
 * host actually spells out that are checked.
 */
export function assertValidRetention(retention: JobRetention | undefined): void {
  if (retention === undefined) return;
  if (typeof retention !== "object" || retention === null) {
    throw new InvalidJobRetentionError("<root>", retention);
  }
  assertWindow("completed", retention.completed);
  assertWindow("failed", retention.failed);
}
