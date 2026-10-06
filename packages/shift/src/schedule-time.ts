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
  return Math.min(first, second);
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
