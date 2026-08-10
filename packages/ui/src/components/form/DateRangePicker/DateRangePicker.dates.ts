/**
 * Civil-day arithmetic for the range picker.
 *
 * Two representations meet here and the boundary between them is the whole
 * point of the file:
 *
 *  - `AAAA-MM-DD` — what the picker's value, the quick ranges and any caller
 *    speak. A day with no instant attached, so it cannot drift.
 *  - a LOCAL `Date` at NOON — what `Calendar` deals in. Noon (not midnight) is
 *    `Calendar.dates.normalizeDate`'s own rule: a daylight-saving jump at
 *    midnight can move a date across a day boundary, and midday never can.
 *
 * The arithmetic itself is `Calendar.dates`' — `addDays` and `startOfWeek` are
 * imported rather than re-written, so a week here starts on the same day the
 * grid draws it.
 *
 * ONE thing needs a time zone: which day is today. Everything after that is
 * calendar arithmetic that has no clock in it.
 */
import { addDays, startOfWeek } from '../Calendar/Calendar.dates';

import type { DayString, WeekStart } from './DateRangePicker.types';

const NOON = 12;
const MS_PER_DAY = 86_400_000;
const MONTHS_PER_QUARTER = 3;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `[year, month 1-12, day]`, or null when the text is not a day at all. */
function dayParts(day: DayString): [number, number, number] | null {
  const parts = DAY_PATTERN.exec(day);
  if (!parts) return null;
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `AAAA-MM-DD` from calendar parts. Month is 1-12. */
function formatDay(year: number, month: number, day: number): DayString {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** A LOCAL `Date` → the day it falls on, read off the same local getters. */
export function toDayString(date: Date): DayString {
  return formatDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * `AAAA-MM-DD` → a LOCAL `Date` at noon, or null when the text is not a real
 * day.
 *
 * Deliberately not `new Date(day)`: the spec reads a bare `AAAA-MM-DD` as UTC
 * midnight, so west of Greenwich it lands on the day BEFORE and every date in
 * the picker is off by one. The round-trip check is what rejects `2026-02-31`,
 * which `Date` would otherwise roll silently into March.
 */
export function toLocalDay(day: DayString | null | undefined): Date | null {
  if (!day) return null;
  const parts = dayParts(day);
  if (!parts) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2], NOON);
  return toDayString(date) === day ? date : null;
}

const civilFormatters = new Map<string, Intl.DateTimeFormat>();

function civilFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = civilFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  civilFormatters.set(timeZone, created);
  return created;
}

/**
 * The civil day `now` falls on, on `timeZone`'s clock (the host's when absent).
 *
 * Read through `formatToParts` rather than by adding an offset to an epoch: the
 * zone database already knows about every transition, and reconstructing one by
 * hand is how a picker ends up a day out for exactly one week of the year.
 */
export function todayIn(timeZone: string | undefined, now: Date): DayString {
  if (!timeZone) return toDayString(now);
  const parts = civilFormatter(timeZone).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** The same day `days` later (or earlier). */
export function shiftDay(day: DayString, days: number): DayString {
  const date = toLocalDay(day);
  return date ? toDayString(addDays(date, days)) : day;
}

/** The 1st of `day`'s month. */
export function startOfMonthDay(day: DayString): DayString {
  const parts = dayParts(day);
  return parts ? formatDay(parts[0], parts[1], 1) : day;
}

/**
 * The 1st of `day`'s CALENDAR quarter — Jan/Apr/Jul/Oct. Fiscal quarters are a
 * different thing and belong in a caller's own quick range, not in a default.
 */
export function startOfQuarterDay(day: DayString): DayString {
  const parts = dayParts(day);
  if (!parts) return day;
  const month = parts[1] - ((parts[1] - 1) % MONTHS_PER_QUARTER);
  return formatDay(parts[0], month, 1);
}

/** The 1st of January of `day`'s year. */
export function startOfYearDay(day: DayString): DayString {
  const parts = dayParts(day);
  return parts ? formatDay(parts[0], 1, 1) : day;
}

/** The first day of `day`'s week, on the same week start the grid uses. */
export function startOfWeekDay(day: DayString, weekStartsOn: WeekStart): DayString {
  const date = toLocalDay(day);
  return date ? toDayString(startOfWeek(date, weekStartsOn)) : day;
}

/**
 * How many days a window covers, both ends INCLUDED — so a single day is 1.
 *
 * Measured on UTC epochs rather than on the local dates: the difference between
 * two local noons can be 23 or 25 hours across a transition, and dividing that
 * by a fixed day length is how a 30-day window starts reporting 29.96.
 */
export function dayCount(from: DayString, to: DayString): number {
  const start = dayParts(from);
  const end = dayParts(to);
  if (!start || !end) return 0;
  const startMs = Date.UTC(start[0], start[1] - 1, start[2]);
  const endMs = Date.UTC(end[0], end[1] - 1, end[2]);
  return Math.round((endMs - startMs) / MS_PER_DAY) + 1;
}

/** `AAAA-MM-DD` sorts lexicographically, so this needs no parsing at all. */
export function isAfterDay(a: DayString, b: DayString): boolean {
  return a > b;
}
