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

/**
 * The zone as a PERSON would read it, in their own language — "Horário Padrão
 * de Brasília", "Brasilia Standard Time".
 *
 * Derived rather than configured, and that is the point: a host passing a
 * display name would be passing COPY, which this repo's own rules say must
 * ship bilingual. `Intl` already knows every zone's name in every locale, so
 * asking it is both less to maintain and correct in languages nobody here
 * speaks.
 *
 * Falls back to the IANA id with its separators softened ("America/Sao_Paulo"
 * → "Sao Paulo"), which is wrong-looking but never blank — a caption is not
 * worth an exception for.
 */
export function timeZoneLabel(timeZone: string, locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (name !== undefined && name !== "") return name;
  } catch {
    // fall through
  }
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/**
 * WHOLE DAYS on the store's clock (FUT-4482).
 *
 * An operator chooses calendar days — "de 10/11 a 20/11" — and means them
 * whole, on the store's clock: from 00:00 on the 10th to the last instant of
 * the 20th. The engine compares INSTANTS against a half-open `[startsAt,
 * endsAt)` and needs no change; these two functions are the whole translation
 * between the two vocabularies, in both directions, so the write path and the
 * read-back cannot disagree about where a day begins.
 *
 * They THROW on a zone the runtime does not know, where `resolveLocalClock`
 * answers null. The two failures are not alike: a clock that cannot be read
 * leaves a schedule firing, which a cart survives, while a window stored on a
 * guessed zone is a promotion that runs on the wrong days with nothing red
 * anywhere. A write is the one place that must refuse.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;
const WALL_CLOCKS = new Map<string, Intl.DateTimeFormat>();

function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  const cached = WALL_CLOCKS.get(timeZone);
  if (cached !== undefined) return cached;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error(
      `@12-apps/discounts: unknown time zone "${timeZone}" — the store's zone must be an IANA ` +
        "id this runtime knows; a window is never stored on a guessed one.",
    );
  }
  WALL_CLOCKS.set(timeZone, format);
  return format;
}

/** The wall clock at `instant` in `timeZone`, read back as if it were UTC. */
function wallAsUtc(instant: number, timeZone: string): number {
  const parts = wallClockFormat(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"), read("second"));
}

/** The `YYYY-MM-DD` the store's calendar shows at `instant`. */
function dayAt(instant: number, timeZone: string): string {
  return new Date(wallAsUtc(instant, timeZone)).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` when it names a real day, else null. */
function realDay(day: string): { y: number; m: number; d: number } | null {
  const match = ISO_DAY.exec(day);
  if (match === null) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real ? { y, m, d } : null;
}

/** Whether `day` is a `YYYY-MM-DD` that names a real calendar day. */
export function isCalendarDay(day: string): boolean {
  return realDay(day) !== null;
}

/**
 * The FIRST instant of `day` on the store's clock — usually its 00:00.
 *
 * Candidates come from the offsets in force a day either side of the day's UTC
 * midnight, which covers every zone's transitions. The earliest candidate that
 * reads as `day` wins: where midnight does not exist (Chile's clocks jump 00:00
 * → 01:00) that is the instant of the jump, which is when the day begins.
 */
function startOfDay(day: string, timeZone: string): Date {
  const parts = realDay(day);
  if (parts === null) throw new RangeError(`not a calendar day: ${day}`);
  const guess = Date.UTC(parts.y, parts.m - 1, parts.d);
  const candidates = [-DAY_MS, 0, DAY_MS].map((shift) => guess - (wallAsUtc(guess + shift, timeZone) - (guess + shift)));
  const onDay = [...new Set(candidates)].filter((instant) => dayAt(instant, timeZone) === day).sort((a, b) => a - b);
  return new Date(onDay[0] ?? candidates[1]!);
}

/**
 * The `YYYY-MM-DD` the store's calendar shows at `instant` — "today" for a bulk
 * extension that counts from today (FUT-4420). Throws on an unknown zone, like
 * every whole-day function here.
 */
export function calendarDayAt(instant: Date, timeZone: string): string {
  wallClockFormat(timeZone);
  return dayAt(instant.getTime(), timeZone);
}

/** `day` moved by `count` whole calendar days (negative moves back). */
export function addCalendarDays(day: string, count: number): string {
  const parts = realDay(day);
  if (parts === null) throw new RangeError(`not a calendar day: ${day}`);
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d + count)).toISOString().slice(0, 10);
}

/** The day after `YYYY-MM-DD`. */
function nextDay(day: string): string {
  const parts = realDay(day);
  if (parts === null) throw new RangeError(`not a calendar day: ${day}`);
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d + 1)).toISOString().slice(0, 10);
}

/**
 * Two chosen days (either may be open) as the half-open window the engine
 * reads: `startsAt` = the first instant of `startsOn`, `endsAt` = the first
 * instant of the day AFTER `endsOn` — so the last chosen day runs whole.
 */
export function wholeDayWindow(
  startsOn: string | null,
  endsOn: string | null,
  timeZone: string,
): { startsAt: Date | null; endsAt: Date | null } {
  wallClockFormat(timeZone);
  return {
    startsAt: startsOn === null ? null : startOfDay(startsOn, timeZone),
    endsAt: endsOn === null ? null : startOfDay(nextDay(endsOn), timeZone),
  };
}

/**
 * A stored window read back as the days it RUNS on, in the store's zone:
 * `startsOn` is the day `startsAt` falls on, `endsOn` the day of the last
 * instant before the exclusive `endsAt`. A window written by
 * {@link wholeDayWindow} reads back as the very days that were chosen; one
 * stored on UTC midnights reads as the days it really covers there, never as
 * the UTC ones.
 */
export function windowCalendarDays(
  startsAt: Date | string | null,
  endsAt: Date | string | null,
  timeZone: string,
): { startsOn: string | null; endsOn: string | null } {
  wallClockFormat(timeZone);
  return {
    startsOn: startsAt === null ? null : dayAt(new Date(startsAt).getTime(), timeZone),
    endsOn: endsAt === null ? null : dayAt(new Date(endsAt).getTime() - 1, timeZone),
  };
}

/** Whether `timeZone` is an IANA id this runtime can place days on. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    wallClockFormat(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * A legacy row (`windowInZone` false) whose bound is not a UTC midnight, so not
 * a window the old form stored: a seeded demo row (`Date.now() ± n days`), a
 * script's write. TYPED so a host's migration loop can catch it per row, log
 * it and go on — one such row must not stop every other row converting — while
 * an unknown zone, which no row survives, still throws a plain `Error`.
 */
export class LegacyWindowNotMidnightError extends RangeError {
  /** Which bound is off midnight. */
  readonly field: "startsAt" | "endsAt";
  /** The stored instant, ISO. */
  readonly bound: string;

  constructor(field: "startsAt" | "endsAt", bound: string) {
    super(
      `@12-apps/discounts: ${field} ${bound} is not a UTC midnight on a row whose windowInZone is ` +
        "false, so it is not a window the old form stored — it is left as it is; fix that row by hand.",
    );
    this.name = "LegacyWindowNotMidnightError";
    this.field = field;
    this.bound = bound;
  }
}

/** A stored bound that is exactly a UTC midnight, as its `YYYY-MM-DD`. */
function legacyDay(bound: Date | string | null, field: "startsAt" | "endsAt"): string | null {
  if (bound === null) return null;
  const instant = new Date(bound);
  const day = instant.toISOString().slice(0, 10);
  if (instant.getTime() !== Date.parse(`${day}T00:00:00.000Z`)) {
    throw new LegacyWindowNotMidnightError(field, instant.toISOString());
  }
  return day;
}

/**
 * A stored window and the row's own word on how it was written (FUT-4482):
 * `windowInZone` is true on every row written with `storeTimeZone` — the
 * whole-day write sets it, and so does this migration — and false (the
 * column's default) on every other: the rows written before the zone went on,
 * and the ones the PREVIOUS release writes while the two serve side by side.
 */
export interface StoredWindow {
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  windowInZone?: boolean | null;
}

/**
 * The days a LEGACY window (`windowInZone` false) is read as: each bound's own
 * UTC date, Término the stored exclusive day — exactly what the form showed
 * before whole days, whatever zone the store is in, and with no zone needed.
 */
export function legacyWindowDays(
  startsAt: Date | string | null,
  endsAt: Date | string | null,
): { startsOn: string | null; endsOn: string | null } {
  const utcDay = (bound: Date | string | null): string | null =>
    bound === null ? null : new Date(bound).toISOString().slice(0, 10);
  return { startsOn: utcDay(startsAt), endsOn: utcDay(endsAt) };
}

/**
 * A LEGACY window — each chosen day as its UTC midnight, Término exclusive —
 * rewritten as the whole-day window of the very same days, in the store's
 * zone: what `wholeDayWindow` stores for them today, with `windowInZone: true`
 * so the row is never read or converted as legacy again.
 *
 * For a host's migration, run in the release that starts passing
 * `storeTimeZone`. It is not what keeps a legacy row's days right — the read
 * does that, from the flag — but it makes the window the engine prices on the
 * window the form shows: the days the old form showed, Início from its 00:00
 * in the zone and Término now the last day it runs, whole.
 *
 * Answers `null` for a row whose flag is already true: nothing to write. Write
 * the answer back under the same condition (`WHERE window_in_zone = false`),
 * so a rerun, a run that failed half way, two runs at once or a UTC+0 zone —
 * where a migrated window is still two UTC midnights — can never shift a row
 * twice. Throws on an unknown zone, as every whole-day write does, and — as a
 * {@link LegacyWindowNotMidnightError}, which a loop catches per row and skips —
 * on a legacy bound that is not a UTC midnight, which the old form never stored.
 */
export function legacyUtcWindowToZoned(
  row: StoredWindow,
  timeZone: string,
): { startsAt: Date | null; endsAt: Date | null; windowInZone: true } | null {
  wallClockFormat(timeZone);
  if (row.windowInZone === true) return null;
  const window = wholeDayWindow(legacyDay(row.startsAt, "startsAt"), legacyDay(row.endsAt, "endsAt"), timeZone);
  return { ...window, windowInZone: true };
}
