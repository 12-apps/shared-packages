import type { LocalClock } from "./engine/schedule";

/**
 * Resolve an instant into a store's own wall clock (FUT-996).
 *
 * Deliberately NOT part of the engine, and exported from its own subpath rather
 * than the root. The engine's contract is that it reaches no clock and no
 * locale data — it runs in an offline tool generator, a browser bundle and a
 * worker — and this function reads `Intl`, which is exactly the dependency that
 * contract exists to keep out. Everything here produces the two integers the
 * engine consumes; nothing here decides anything about a discount.
 *
 * It lives in the PACKAGE rather than in each host because there must be one
 * implementation. The admin grid's "ativa agora" dot runs in a browser, the
 * price a shopper is charged is computed on a server, and a second copy of
 * "which weekday is it in São Paulo at 23:50" is how those two start
 * disagreeing about the same minute — silently, and only for the hour that
 * matters.
 */

/**
 * `Intl` reports a Sunday-first weekday; the schedule axis is Monday-first, the
 * same one `WeekHours` and every hours screen uses. This table is the whole
 * conversion, written as data so it cannot be got subtly wrong by arithmetic.
 */
const MONDAY_FIRST: Readonly<Record<string, number>> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/**
 * The store's weekday and minute-of-day at `instant`, or null when the zone is
 * not one this runtime knows.
 *
 * NULL rather than a fallback, and the CALLER decides what that means — which
 * is the only honest split, because the two callers need opposite things. A
 * cart must keep pricing (a scheduled rule fires; see `scheduleCovers`), and a
 * teaser must stay quiet rather than promise an hour it cannot name. A default
 * chosen here would silently impose one of those on both.
 */
export function resolveLocalClock(instant: Date, timeZone: string): LocalClock | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(instant);
    const read = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    const weekday = MONDAY_FIRST[read("weekday")];
    const hour = Number(read("hour"));
    const minute = Number(read("minute"));
    if (weekday === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    // `hour12: false` yields 24 for midnight in some ICU versions — a real,
    // once-a-day discrepancy that would put every midnight instant outside
    // every window.
    return { weekday, minutes: (hour % 24) * 60 + minute };
  } catch {
    return null;
  }
}
