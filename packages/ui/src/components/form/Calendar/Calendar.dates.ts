import type { MonthMatrix, MonthMatrixDay } from './Calendar.types';

const DAYS_PER_WEEK = 7;
// Six rows always cover a month, whichever weekday it starts on.
const MAX_CELLS = 42;
const NOON = 12;

// Every comparison happens at noon so daylight-saving shifts can never move a
// date across a day boundary.
export const normalizeDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(NOON, 0, 0, 0);
  return normalized;
};

export const isSameDay = (date1: Date, date2: Date): boolean =>
  date1.getFullYear() === date2.getFullYear() &&
  date1.getMonth() === date2.getMonth() &&
  date1.getDate() === date2.getDate();

export const isBetween = (date: Date, start: Date, end: Date): boolean => {
  const normalized = normalizeDate(date);
  return normalized >= normalizeDate(start) && normalized <= normalizeDate(end);
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

export const startOfWeek = (date: Date, firstDayOfWeek = 0): Date => {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day < firstDayOfWeek ? DAYS_PER_WEEK : 0) + day - firstDayOfWeek;
  result.setDate(result.getDate() - diff);
  return result;
};

// Day 0 of the next month is the last day of this one.
export const endOfMonth = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0);

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export const generateMonthMatrix = (
  month: number,
  year: number,
  firstDayOfWeek = 0,
): MonthMatrix => {
  const firstDay = new Date(year, month, 1);
  const lastDay = endOfMonth(firstDay);
  const currentDate = startOfWeek(firstDay, firstDayOfWeek);

  const weeks: MonthMatrixDay[][] = [];
  let currentWeek: MonthMatrixDay[] = [];

  for (let i = 0; i < MAX_CELLS; i++) {
    currentWeek.push({
      date: new Date(currentDate),
      inCurrentMonth: currentDate.getMonth() === month,
      key: dayKey(currentDate),
    });

    if (currentWeek.length === DAYS_PER_WEEK) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    currentDate.setDate(currentDate.getDate() + 1);

    // Stop on a week boundary once the month is behind us, so a month that fits
    // in five rows does not get a trailing sixth.
    if (currentWeek.length === 0 && currentDate > lastDay) break;
  }

  return { weeks, month, year };
};

export const getWeekdayNames = (locale = 'en-US', firstDayOfWeek = 0): string[] => {
  const baseDate = new Date(2025, 0, 5); // A Sunday
  const weekdays: string[] = [];

  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const date = addDays(baseDate, (i + firstDayOfWeek) % DAYS_PER_WEEK);
    weekdays.push(date.toLocaleDateString(locale, { weekday: 'narrow' }));
  }

  return weekdays;
};

export const getMonthName = (month: number, year: number, locale = 'en-US'): string =>
  new Date(year, month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
