/**
 * Billing period arithmetic (FUT-132). Pure, UTC, no dependencies.
 *
 * Deliberately hand-rolled rather than pulled from a date library: the whole
 * of it is one rule with one edge case, and the edge case is the reason the
 * module exists.
 *
 * ## The anchor
 *
 * A customer who subscribes on the 31st has no 31st in February. Clamping to
 * the last day of the month is the only sane answer — but clamping *and then
 * advancing from the clamped date* walks the billing day permanently earlier
 * (31 Jan → 28 Feb → 28 Mar → …), quietly moving a customer's renewal by three
 * days a year and mis-stating every period boundary after the first February.
 *
 * So the anchor day is an INPUT, not something re-read from the previous
 * period. Callers derive it once from the subscription's original start
 * (`anchorDayOf`) and it survives every clamp: 31 Jan → 28 Feb → 31 Mar.
 */

/** Billing cadence (mirrors the `interval` CHECK on plans/subscriptions). */
export type BillingInterval = "MONTH" | "YEAR";

const INTERVALS: readonly BillingInterval[] = ["MONTH", "YEAR"];

/** Type guard for a value read out of the database. */
export function isBillingInterval(value: string): value is BillingInterval {
  return (INTERVALS as readonly string[]).includes(value);
}

/** Days in the UTC month containing `year`/`month` (0-based month). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Add whole months in UTC, pinning the day-of-month to `anchorDay` and
 * clamping to the target month's length.
 *
 * UTC throughout: two servers in different zones must compute the same renewal
 * instant, and local-time arithmetic across a DST boundary would shift it by
 * an hour — enough to move a midnight boundary onto the previous day.
 */
function addMonthsUtc(from: Date, months: number, anchorDay: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  // Normalize the month overflow (month 12 → January of the next year) before
  // asking how long the target month is.
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * The billing day-of-month a subscription is anchored to.
 *
 * Read from the subscription's ORIGINAL start (its `createdAt`), never from
 * the current period — that is what makes the anchor immune to clamping. No
 * extra column: `createdAt` is the subscribe instant and never changes.
 */
export function anchorDayOf(subscribedAt: Date): number {
  return subscribedAt.getUTCDate();
}

/**
 * The end of the cycle that starts at `start`.
 *
 * A YEAR is 12 months rather than 365 days, so the anniversary of a 29 Feb
 * subscription lands on 28 Feb rather than drifting a day per leap year.
 */
export function periodEnd(
  start: Date,
  interval: BillingInterval,
  anchorDay: number,
): Date {
  return addMonthsUtc(start, interval === "YEAR" ? 12 : 1, anchorDay);
}

/** The cycle following the one that ends at `currentPeriodEnd`. */
export function nextPeriod(
  currentPeriodEnd: Date,
  interval: BillingInterval,
  anchorDay: number,
): { start: Date; end: Date } {
  return {
    start: currentPeriodEnd,
    end: periodEnd(currentPeriodEnd, interval, anchorDay),
  };
}

/** The instant a `trialDays`-long trial started at `from` runs out. */
export function trialEnd(from: Date, trialDays: number): Date {
  return new Date(from.getTime() + trialDays * 86_400_000);
}
