import { isBetween, isSameDay, normalizeDate } from './Calendar.dates';
import type {
  CalendarProps,
  DateRange,
  DayRenderArgs,
  MonthMatrixDay,
  SelectionMode,
} from './Calendar.types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

type RangeUpdate =
  | { kind: 'start'; range: DateRange }
  | { kind: 'complete'; range: Required<DateRange> }
  | { kind: 'rejected' };

// The endpoints carry their own styling, so "in range" means the interior only.
const strictlyBetween = (date: Date, start: Date, end: Date): boolean =>
  isBetween(date, start, end) && !isSameDay(date, start) && !isSameDay(date, end);

const violatesLength = (
  nights: number,
  minRangeLength?: number,
  maxRangeLength?: number,
): boolean => {
  if (minRangeLength && nights < minRangeLength - 1) return true;
  if (maxRangeLength && nights > maxRangeLength - 1) return true;
  return false;
};

// Decides what a click on `candidate` does to the current range: opens a new one,
// closes the open one, or is refused because the result would break a constraint.
export const nextRangeStep = ({
  start,
  end,
  candidate,
  allowSameDayRange,
  minRangeLength,
  maxRangeLength,
}: {
  start?: Date | null;
  end?: Date | null;
  candidate: Date;
  allowSameDayRange: boolean;
  minRangeLength?: number;
  maxRangeLength?: number;
}): RangeUpdate => {
  // Nothing started, or a finished range: this click opens a new one.
  if (!start || end) return { kind: 'start', range: { start: candidate, end: null } };

  // Clicking before the start picks the range backwards.
  const [rangeStart, rangeEnd] = candidate < start ? [candidate, start] : [start, candidate];

  if (!allowSameDayRange && isSameDay(rangeStart, rangeEnd)) return { kind: 'rejected' };

  const nights = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY);
  if (violatesLength(nights, minRangeLength, maxRangeLength)) return { kind: 'rejected' };

  return { kind: 'complete', range: { start: rangeStart, end: rangeEnd } };
};

const isDateSelected = ({
  selectionMode,
  value,
  range,
  date,
}: {
  selectionMode: SelectionMode;
  value: Date | null;
  range: DateRange;
  date: Date;
}): boolean => {
  if (selectionMode === 'single') return value ? isSameDay(date, value) : false;

  const { start, end } = range;
  return Boolean((start && isSameDay(date, start)) || (end && isSameDay(date, end)));
};

const isDateInRange = ({
  selectionMode,
  range,
  hoveredDate,
  date,
  isDisabled,
}: {
  selectionMode: SelectionMode;
  range: DateRange;
  hoveredDate: Date | null;
  date: Date;
  isDisabled: (date: Date) => boolean;
}): boolean => {
  if (selectionMode !== 'range') return false;

  const { start, end } = range;
  if (start && end) return strictlyBetween(date, start, end);

  // With only one end chosen, hovering previews the range the next click makes.
  if (!start || !hoveredDate || isDisabled(hoveredDate)) return false;

  const [previewStart, previewEnd] =
    start < hoveredDate ? [start, hoveredDate] : [hoveredDate, start];
  return strictlyBetween(date, previewStart, previewEnd);
};

export const isDateDisabledBy = ({
  date,
  minDate,
  maxDate,
  isDateDisabled,
}: {
  date: Date;
  minDate?: Date;
  maxDate?: Date;
  isDateDisabled?: CalendarProps['isDateDisabled'];
}): boolean => {
  // Bounds are normalized to noon so a min/max given at midnight does not
  // exclude its own day.
  if (minDate && date < normalizeDate(minDate)) return true;
  if (maxDate && date > normalizeDate(maxDate)) return true;
  return Boolean(isDateDisabled?.(date));
};

// Everything a day cell needs to know about itself, derived in one place so the
// custom renderDay hook and the built-in cell see exactly the same facts.
export const buildDayArgs = ({
  day,
  selectionMode,
  value,
  range,
  hoveredDate,
  today,
  isDisabled,
}: {
  day: MonthMatrixDay;
  selectionMode: SelectionMode;
  value: Date | null;
  range: DateRange;
  hoveredDate: Date | null;
  today: Date;
  isDisabled: (date: Date) => boolean;
}): DayRenderArgs => {
  const { date, inCurrentMonth } = day;
  const inRangeMode = selectionMode === 'range';

  return {
    date,
    inCurrentMonth,
    selected: isDateSelected({ selectionMode, value, range, date }),
    inRange: isDateInRange({ selectionMode, range, hoveredDate, date, isDisabled }),
    rangeStart: Boolean(inRangeMode && range.start && isSameDay(date, range.start)),
    rangeEnd: Boolean(inRangeMode && range.end && isSameDay(date, range.end)),
    disabled: isDisabled(date),
    today: isSameDay(date, today),
    hovered: hoveredDate ? isSameDay(date, hoveredDate) : false,
  };
};
