/**
 * A saved report's delivery schedule (FUT-776), and the arithmetic a host's job
 * needs to honour it.
 *
 * This module is PURE: no I/O, no clock of its own, no framework. The shape is
 * shared by the wire schema (`server/schedule.ts`), the settings dialog and a
 * host's scheduler, so all three read the same four cadences the same way.
 *
 * ## The calendar rules (decided here, so a host cannot differ)
 *
 * - **Wall clock, in the schedule's zone.** "Monday 08:00" means 08:00 on that
 *   zone's calendar, so the instant moves with daylight saving; it is never a
 *   fixed UTC offset frozen at the moment the schedule was saved.
 * - **A time that does not exist** (the hour skipped when clocks go forward)
 *   fires once, shifted forward by the length of the gap: 02:30 on a night
 *   that jumps 02:00 to 03:00 fires at 03:30.
 * - **A time that happens twice** (the hour repeated when clocks go back)
 *   fires at the first of the two, once.
 * - **Quinzenal is every OTHER week**, counted from the first matching weekday
 *   on or after `startsOn`, which the server sets to the date of the FIRST
 *   send. `startsOn` is stored, never recomputed from "now", so the fortnight
 *   does not slip when a job restarts.
 * - **Mensal on the 29th, 30th or 31st** fires on the LAST day of a shorter
 *   month, so a schedule never skips February.
 */
import { isValidTimeZone } from './time';

export const SCHEDULE_CADENCES = ['daily', 'weekly', 'biweekly', 'monthly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** `HH:MM`, 24-hour, zero-padded. */
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** `YYYY-MM-DD`. Whether the date exists is checked by {@link isValidCivilDate}. */
export const SCHEDULE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The most people one schedule may name. */
export const SCHEDULE_MAX_RECIPIENTS = 50;

export interface ReportSchedule {
  /** Off keeps every other field, so switching back on restores the choices. */
  enabled: boolean;
  cadence: ScheduleCadence;
  /** 0 Sunday … 6 Saturday. Present for `weekly` and `biweekly`. */
  weekday?: number;
  /** 1 … 31. Present for `monthly`; 29-31 clamp to the month's last day. */
  dayOfMonth?: number;
  /** Local time of day, `HH:MM`. */
  time: string;
  /** IANA zone the time is read in — the store's, stamped by the server. */
  timeZone: string;
  /** Opaque HOST user ids. The host decides who may be on this list. */
  recipients: string[];
  /** Local date (`YYYY-MM-DD`) the fortnights of `biweekly` are counted from. */
  startsOn: string;
}

const DAY_MS = 86_400_000;

interface Civil {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // `h23`, never `hour12: false`, which renders midnight as 24 on some runtimes.
    hourCycle: 'h23',
  });
  formatters.set(timeZone, created);
  return created;
}

/** The zone's offset from UTC at an instant, in milliseconds (east is positive). */
function offsetAt(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

function civilIn(instantMs: number, timeZone: string): Civil {
  const local = new Date(instantMs + offsetAt(instantMs, timeZone));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

/** Days since 1970-01-01 of a civil date — calendar arithmetic with no zone in it. */
function dayNumber({ year, month, day }: Civil): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function civilOfDay(n: number): Civil {
  const date = new Date(n * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function weekdayOfDay(n: number): number {
  return new Date(n * DAY_MS).getUTCDay();
}

function daysInMonth({ year, month }: Civil): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether `YYYY-MM-DD` names a real calendar day. */
function isValidCivilDate(value: string): boolean {
  if (!SCHEDULE_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseCivilDate(value: string): Civil {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

/** The instant a zone's wall clock reads `hh:mm` on a civil date. See the header for gaps and repeats. */
function wallClockInstant(civil: Civil, hh: number, mm: number, timeZone: string): number {
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day, hh, mm);
  const before = offsetAt(naive - DAY_MS, timeZone);
  const after = offsetAt(naive + DAY_MS, timeZone);
  const real = [...new Set([before, after])]
    .map((offset) => naive - offset)
    .filter((candidate) => candidate + offsetAt(candidate, timeZone) === naive);
  // No candidate reads the asked wall time: it falls in a spring-forward gap.
  // The offset from BEFORE the jump lands just after the gap.
  return real.length > 0 ? Math.min(...real) : naive - before;
}

/** Whether the schedule fires on the civil day `n`. */
function firesOn(schedule: ReportSchedule, n: number): boolean {
  switch (schedule.cadence) {
    case 'daily':
      return true;
    case 'weekly':
      return weekdayOfDay(n) === schedule.weekday;
    case 'biweekly': {
      if (weekdayOfDay(n) !== schedule.weekday) return false;
      const start = dayNumber(parseCivilDate(schedule.startsOn));
      const first = start + ((((schedule.weekday ?? 0) - weekdayOfDay(start)) % 7) + 7) % 7;
      return n >= first && ((n - first) / 7) % 2 === 0;
    }
    case 'monthly': {
      const civil = civilOfDay(n);
      return civil.day === Math.min(schedule.dayOfMonth ?? 1, daysInMonth(civil));
    }
  }
}

/** The longest gap between two firings of any cadence is under 62 days; this leaves room. */
const SEARCH_DAYS = 400;

/**
 * The next `count` instants STRICTLY after `after` at which the schedule fires.
 *
 * Empty for a disabled or malformed schedule — a scheduler asking "when next?"
 * of one that should not run gets nothing to arm, not a guess.
 */
export function nextOccurrences(schedule: ReportSchedule, after: Date, count = 1): Date[] {
  if (!schedule.enabled || count < 1 || !isRunnable(schedule)) return [];
  const [hh, mm] = schedule.time.split(':').map(Number) as [number, number];
  const afterMs = after.getTime();
  const firstDay = dayNumber(civilIn(afterMs, schedule.timeZone)) - 1;
  const found: Date[] = [];
  for (let n = firstDay; n < firstDay + SEARCH_DAYS && found.length < count; n += 1) {
    if (!firesOn(schedule, n)) continue;
    const instant = wallClockInstant(civilOfDay(n), hh, mm, schedule.timeZone);
    if (instant > afterMs) found.push(new Date(instant));
  }
  return found;
}

/**
 * A stable name for one firing — `YYYY-MM-DDTHH:MM` on the schedule's calendar —
 * for a host to key idempotency on, so a retry or a restarted worker never
 * sends the same occurrence twice. Derived from the wall clock the person
 * chose, so it does not change when the zone's offset does.
 */
export function occurrenceKey(schedule: ReportSchedule, occurrence: Date): string {
  const civil = civilIn(occurrence.getTime(), schedule.timeZone);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(civil.year, 4)}-${pad(civil.month)}-${pad(civil.day)}T${schedule.time}`;
}

function inRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max;
}

/** Whether every field the cadence reads is present and real. */
export function isRunnable(schedule: ReportSchedule): boolean {
  if (!SCHEDULE_TIME_PATTERN.test(schedule.time) || !isValidTimeZone(schedule.timeZone)) return false;
  switch (schedule.cadence) {
    case 'daily':
      return true;
    case 'monthly':
      return inRange(schedule.dayOfMonth, 1, 31);
    case 'weekly':
      return inRange(schedule.weekday, 0, 6);
    case 'biweekly':
      return inRange(schedule.weekday, 0, 6) && isValidCivilDate(schedule.startsOn);
  }
}

/** The local calendar date (`YYYY-MM-DD`) of an instant in a zone. */
export function civilDateOf(instant: Date, timeZone: string): string {
  const civil = civilIn(instant.getTime(), timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(civil.year).padStart(4, '0')}-${pad(civil.month)}-${pad(civil.day)}`;
}
