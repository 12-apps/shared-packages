/**
 * Wall-clock arithmetic in an IANA time zone, with no dependency: what "the
 * same time, N weeks later" is when a daylight-saving change sits between.
 *
 * The runtime's `Intl` knows every zone's offsets; this file only asks it.
 */

const DAY_MS = 24 * 60 * 60_000;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/** Whether the runtime knows `timeZone` as an IANA zone. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
    millisecond: instant.getUTCMilliseconds(),
  };
}

function asUtcMs(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.millisecond);
}

/** The zone's offset from UTC at `instantMs`, in ms (positive east of Greenwich). */
function offsetAt(instantMs: number, timeZone: string): number {
  return asUtcMs(wallClockOf(new Date(instantMs), timeZone)) - instantMs;
}

/**
 * The instant a wall-clock time names in `timeZone`. A time skipped by a
 * spring-forward resolves to the instant just after the gap; a time repeated by
 * a fall-back resolves to its first occurrence.
 */
function instantOf(wall: WallClock, timeZone: string): number {
  const naive = asUtcMs(wall);
  const first = naive - offsetAt(naive, timeZone);
  const second = naive - offsetAt(first, timeZone);
  const candidates = [first, second];
  // A candidate is exact when the zone shows the requested wall time at it.
  const exact = candidates.filter((ms) => asUtcMs(wallClockOf(new Date(ms), timeZone)) === naive);
  // Both exact: a repeated hour, take the first. Neither: a gap, and the later
  // candidate is the wall time pushed forward by the gap (02:30 -> 03:30).
  return exact.length > 0 ? Math.min(...exact) : Math.max(...candidates);
}

/** `instant` moved by `days` calendar days, keeping its wall-clock time in `timeZone`. */
export function addZonedDays(instant: Date, days: number, timeZone: string): Date {
  const wall = wallClockOf(instant, timeZone);
  const shifted = new Date(asUtcMs(wall) + days * DAY_MS);
  return new Date(
    instantOf(
      {
        ...wall,
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
      },
      timeZone,
    ),
  );
}

/** A calendar date as `YYYY-MM-DD`, with no zone: what a person means by "Monday the 3rd". */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real `YYYY-MM-DD` date (no 2026-02-30). */
export function isLocalDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localDateMs(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function toLocalDate(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` moved by `days` calendar days. */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  return toLocalDate(localDateMs(date) + days * DAY_MS);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function localDaysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((localDateMs(to) - localDateMs(from)) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  return ((new Date(localDateMs(date)).getUTCDay() + 6) % 7) + 1;
}

/** Day of the month, 1–31. */
export function dayOfMonth(date: LocalDate): number {
  return new Date(localDateMs(date)).getUTCDate();
}

/** The calendar date and the minutes since local midnight that `instant` shows in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): { date: LocalDate; minutes: number } {
  const wall = wallClockOf(instant, timeZone);
  return {
    date: toLocalDate(Date.UTC(wall.year, wall.month - 1, wall.day)),
    minutes: wall.hour * 60 + wall.minute,
  };
}

/**
 * The instant `minutes` past local midnight of `date` names in `timeZone`,
 * resolved across a daylight-saving change as {@link addZonedDays} resolves it.
 */
export function zonedInstant(date: LocalDate, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(
    instantOf(
      { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 },
      timeZone,
    ),
  );
}

/**
 * Whether `minutes` past local midnight of `date` is a time the wall clock of
 * `timeZone` actually shows — false inside a spring-forward gap, which
 * {@link zonedInstant} would otherwise push forward without a word.
 */
export function wallTimeExists(date: LocalDate, minutes: number, timeZone: string): boolean {
  const shown = zonedParts(zonedInstant(date, minutes, timeZone), timeZone);
  return shown.date === date && shown.minutes === minutes;
}
