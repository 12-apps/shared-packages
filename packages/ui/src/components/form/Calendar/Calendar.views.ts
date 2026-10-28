/**
 * The month and year views of `captionLayout="selectors"`: which years the
 * list offers, which months are out of reach, and where the day grid lands
 * after a pick. Pure, so the rules are tested without rendering anything.
 */
import { normalizeDate } from './Calendar.dates';

export type CalendarView = 'days' | 'months' | 'years';

const MONTHS_PER_YEAR = 12;

/**
 * The year list's span when the host gives no bound: the common date-picker
 * window, wide enough for a birth date and for an appointment years ahead.
 */
export const DEFAULT_MIN_YEAR = 1900;
export const DEFAULT_MAX_YEAR = 2099;

export interface DateBounds {
  minDate?: Date;
  maxDate?: Date;
}

const startOfMonth = (year: number, month: number): Date => normalizeDate(new Date(year, month, 1));
const endOfMonth = (year: number, month: number): Date => normalizeDate(new Date(year, month + 1, 0));

/**
 * Every year the list offers, newest first. The shown year is always in it, so
 * a calendar opened outside its own bounds still has a highlighted year to
 * start from rather than a list that does not contain where you are.
 */
export const yearOptions = ({ minDate, maxDate }: DateBounds, shownYear: number): number[] => {
  const first = Math.min(minDate?.getFullYear() ?? DEFAULT_MIN_YEAR, shownYear);
  const last = Math.max(maxDate?.getFullYear() ?? DEFAULT_MAX_YEAR, shownYear);
  return Array.from({ length: last - first + 1 }, (_, index) => last - index);
};

/**
 * Whether the year lies wholly outside the bounds — only ever the shown year,
 * listed so the list contains where the calendar is.
 */
export const isYearOutOfBounds = (year: number, { minDate, maxDate }: DateBounds): boolean =>
  (minDate !== undefined && year < minDate.getFullYear()) ||
  (maxDate !== undefined && year > maxDate.getFullYear());

/** Whether no day of the month can be picked because of `minDate`/`maxDate`. */
export const isMonthOutOfBounds = (
  year: number,
  month: number,
  { minDate, maxDate }: DateBounds,
): boolean =>
  (minDate !== undefined && endOfMonth(year, month) < normalizeDate(minDate)) ||
  (maxDate !== undefined && startOfMonth(year, month) > normalizeDate(maxDate));

/** The month to show in `year`: the one asked for, pulled inside the bounds. */
export const clampMonthToBounds = (year: number, month: number, { minDate, maxDate }: DateBounds): number => {
  if (minDate && year === minDate.getFullYear() && month < minDate.getMonth()) return minDate.getMonth();
  if (maxDate && year === maxDate.getFullYear() && month > maxDate.getMonth()) return maxDate.getMonth();
  return month;
};

/**
 * The day focus lands on in the picked month: the same day of the month as
 * before (the 31st becomes the month's last day), held inside the bounds.
 */
export const landingDay = (year: number, month: number, dayOfMonth: number, bounds: DateBounds): Date => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = normalizeDate(new Date(year, month, Math.min(dayOfMonth, lastDay)));
  if (bounds.minDate && day < normalizeDate(bounds.minDate)) return normalizeDate(bounds.minDate);
  if (bounds.maxDate && day > normalizeDate(bounds.maxDate)) return normalizeDate(bounds.maxDate);
  return day;
};

/** Whether the arrow that moves `delta` months from `month` leads anywhere pickable. */
export const canShiftMonth = (month: Date, delta: number, bounds: DateBounds): boolean => {
  const target = new Date(month.getFullYear(), month.getMonth() + delta, 1);
  return !isMonthOutOfBounds(target.getFullYear(), target.getMonth(), bounds);
};

/** The twelve month indexes, for the month grid. */
export const MONTH_INDEXES = Array.from({ length: MONTHS_PER_YEAR }, (_, index) => index);

// A lookup rather than a switch, like the day grid's: one entry per move.
const GRID_MOVES: Record<string, (index: number, columns: number, length: number) => number> = {
  ArrowLeft: (index) => index - 1,
  ArrowRight: (index) => index + 1,
  ArrowUp: (index, columns) => index - columns,
  ArrowDown: (index, columns) => index + columns,
  Home: () => 0,
  End: (_, __, length) => length - 1,
};

/**
 * Where focus moves in a month or year grid for a key, held to the grid; null
 * when the key is not a move.
 */
export const moveInGrid = (key: string, index: number, columns: number, length: number): number | null => {
  const move = GRID_MOVES[key];
  if (!move) return null;
  return Math.min(Math.max(move(index, columns, length), 0), length - 1);
};
