/**
 * The WEEKLY schedule inside a discount's campaign window (FUT-996).
 *
 * `startsAt`/`endsAt` answer "for how long is this campaign on?". This answers
 * the second question a merchant actually asks — "and within that, on which
 * days and at what hours?" — so that "toda sexta, das 16:00 às 20:00" and
 * "segunda e terça à tarde" are expressible at all.
 *
 * Pure and clock-free, like the rest of the engine: it never calls `new Date()`
 * and never touches `Intl`. A recurring window is a WALL-CLOCK fact and is
 * therefore only meaningful in the store's own timezone — but resolving an
 * IANA zone is the HOST's job, because this module runs in an offline tool
 * generator, a browser bundle and a worker, and none of them may depend on a
 * timezone database. The host resolves an instant into a {@link LocalClock} and
 * passes it in; everything here is integer arithmetic over that.
 *
 * A rule with no schedule is every rule that exists today, and answers `true`
 * unconditionally — which is what makes this a strictly additive change.
 */

/** Monday-first, matching the seven-entry week every hours surface uses. */
export const MAX_SCHEDULE_WINDOWS = 7;

/**
 * One "these days, these hours" row of a schedule.
 *
 * A LIST of these rather than one shared time range, because "sexta 16–20 e
 * sábado 12–16" is one promotion to the merchant selling it and two rows here.
 * Deliberately NOT a per-weekday hours table (the shape `openingHours` uses):
 * that editor asks seven questions to answer one, and a promotion is a
 * sentence, not a business week.
 */
export interface DiscountScheduleWindow {
  /**
   * Weekdays this window runs on, **Monday-first, 0..6**.
   *
   * Monday-first because that is what `WeekHours` and every hours screen in a
   * host already uses; `Date#getDay()` is Sunday-first and the conversion is
   * `(getDay() + 6) % 7`. Stated here because a schedule that is off by one day
   * is a promotion that runs on the wrong day and looks like a pricing bug.
   */
  days: readonly number[];
  /** `HH:MM`, 24-hour, in the STORE's timezone. Inclusive. */
  from: string;
  /** `HH:MM`, 24-hour, in the STORE's timezone. EXCLUSIVE. */
  to: string;
}

/** A rule's weekly schedule. Null/absent = always, within the campaign window. */
export interface DiscountSchedule {
  windows: readonly DiscountScheduleWindow[];
}

/**
 * An instant already resolved into the store's own wall clock.
 *
 * Two integers rather than a `Date`, so this module cannot be tempted to read a
 * timezone: by the time a value reaches here the only question left is
 * arithmetic. The host builds it once per line and once per evaluation.
 */
export interface LocalClock {
  /** Monday-first, 0..6 — the same axis as {@link DiscountScheduleWindow.days}. */
  weekday: number;
  /** Minutes since local midnight, 0..1439. */
  minutes: number;
}

/** `HH:MM` → minutes since midnight, or null when it is not a time at all. */
export function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The weekday before this one, on the Monday-first axis. */
function previousWeekday(weekday: number): number {
  return (weekday + 6) % 7;
}

/**
 * Whether one window is running at `clock`.
 *
 * A `to` EARLIER than `from` is a bar that shuts at 02:00, not a typo — the
 * window runs past midnight into the next day, exactly as `minutesOpen` reads a
 * store's opening hours. Treating it as invalid would refuse the single most
 * common shape of a happy hour.
 *
 * So an overnight window is two intervals: `[from, 24:00)` on each of its own
 * days, and `[00:00, to)` on the day AFTER each of them — which is why the
 * second test asks about `previousWeekday`. A Saturday 00:30 instant is inside
 * a Friday 22:00–02:00 window, and no amount of testing Saturday against
 * `days` would ever discover that.
 *
 * Half-open `[from, to)`, matching `[startsAt, endsAt)`: a window ending at
 * 20:00 is over the instant 20:00 begins.
 */
function windowCovers(window: DiscountScheduleWindow, clock: LocalClock): boolean {
  const from = toMinutes(window.from);
  const to = toMinutes(window.to);
  // A malformed or empty window covers NOTHING rather than everything: it can
  // only arrive by bypassing the validator, and the safe reading of "I cannot
  // tell what this means" is not "charge the discount".
  if (from === null || to === null || from === to) return false;
  const days = new Set(window.days);
  if (to > from) {
    return days.has(clock.weekday) && clock.minutes >= from && clock.minutes < to;
  }
  if (days.has(clock.weekday) && clock.minutes >= from) return true;
  return days.has(previousWeekday(clock.weekday)) && clock.minutes < to;
}

/**
 * Whether the schedule is running at `clock` — true if ANY window is.
 *
 * `null` schedule → always true, which is every rule that predates this
 * feature. A schedule with no windows is a rule an operator half-built; it
 * covers nothing, and the validator refuses to save one.
 *
 * `clock` of `null` → **true**, and this is the load-bearing failure
 * direction. It means the host could not resolve a timezone, and the same
 * unknown makes `inStoreZone` fall back to the caller's clock rather than throw
 * ("an unknown zone must not take the storefront down — nor refuse a payment")
 * and `readStoreHours` keep a store selling. Failing the other way would
 * silently switch off every scheduled promotion in a store on one bad timezone
 * string — with nothing red anywhere, because a promotion that does not fire
 * looks exactly like a promotion nobody qualified for.
 */
export function scheduleCovers(
  schedule: DiscountSchedule | null | undefined,
  clock: LocalClock | null | undefined,
): boolean {
  if (schedule === null || schedule === undefined) return true;
  if (clock === null || clock === undefined) return true;
  return schedule.windows.some((window) => windowCovers(window, clock));
}

/**
 * Whether a schedule is one this engine can act on at all.
 *
 * Used by the validator and by hosts reading a stored blob back; the evaluator
 * itself is deliberately tolerant (see `windowCovers`) because refusing to
 * price a cart is never the right answer to a bad row.
 */
export function isUsableSchedule(schedule: DiscountSchedule): boolean {
  if (schedule.windows.length === 0) return false;
  if (schedule.windows.length > MAX_SCHEDULE_WINDOWS) return false;
  return schedule.windows.every(
    (window) =>
      window.days.length > 0 &&
      window.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      toMinutes(window.from) !== null &&
      toMinutes(window.to) !== null &&
      window.from !== window.to,
  );
}

/**
 * The next window that OPENS later today, or null — the teaser's whole input
 * (FUT-996).
 *
 * "Later today" and not "next Friday": a card promising an offer six days out
 * is noise on a screen the shopper is reading now, and it advertises a price
 * they cannot have for almost a week. Scoped to the current weekday, the label
 * is a reason to wait rather than a reason to leave.
 *
 * A window already running returns nothing from here — that is the BADGE's job,
 * and a card must never carry both. The two are mutually exclusive by
 * construction because this only looks at windows whose `from` is still ahead
 * on the clock.
 *
 * Ties break on the earliest opening, so a card teases the offer that arrives
 * soonest rather than whichever row the operator happened to add first.
 */
export function nextWindowToday(
  schedule: DiscountSchedule | null | undefined,
  clock: LocalClock | null | undefined,
): DiscountScheduleWindow | null {
  if (schedule === null || schedule === undefined) return null;
  if (clock === null || clock === undefined) return null;
  const upcoming = schedule.windows
    .filter((window) => {
      const from = toMinutes(window.from);
      if (from === null || from <= clock.minutes) return false;
      return window.days.includes(clock.weekday);
    })
    .sort((a, b) => (toMinutes(a.from) ?? 0) - (toMinutes(b.from) ?? 0));
  return upcoming[0] ?? null;
}
