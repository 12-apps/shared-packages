import { useMemo } from 'react';

import type { DateTimeDisplayProps } from './DateTimeDisplay.types';

type DateFormat = NonNullable<DateTimeDisplayProps['dateFormat']>;
type TimeFormat = NonNullable<DateTimeDisplayProps['timeFormat']>;

/**
 * Format a date for display
 */
function formatDatePart(date: Date, format: DateFormat): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: format === 'numeric' ? '2-digit' : format === 'short' ? 'short' : 'long',
    day: format === 'numeric' ? '2-digit' : 'numeric',
  };
  return date.toLocaleDateString(undefined, options);
}

/**
 * Format time for display
 */
function formatTimePart(date: Date, timeFormat: TimeFormat, showTimezone: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: timeFormat === '12h',
    ...(showTimezone && { timeZoneName: 'short' }),
  };
  return date.toLocaleTimeString(undefined, options);
}

interface DateTimeParts {
  /** null when no date was given or the given one does not parse. */
  dateObj: Date | null;
  formattedDate: string | null;
  formattedTime: string | null;
  /** The long form shown in the tooltip. */
  fullDateTime: string | null;
}

interface DateTimePartsArgs {
  date: DateTimeDisplayProps['date'];
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  showTimezone: boolean;
}

const isValidDate = (date: Date | null): date is Date =>
  date !== null && !isNaN(date.getTime());

/**
 * A date landing exactly on midnight is taken to carry no time of day — callers
 * pass date-only values as `new Date('2026-08-05')`, which parses to 00:00:00.
 * The cost is that a genuine midnight timestamp renders without its time.
 */
const hasTimeOfDay = (date: Date): boolean =>
  !(date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0);

const longForm = (date: Date, withTime: boolean): string => {
  const dateParts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };

  if (!withTime) return date.toLocaleDateString(undefined, dateParts);

  return date.toLocaleString(undefined, {
    ...dateParts,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
};

export const useDateTimeParts = ({
  date,
  dateFormat,
  timeFormat,
  showTimezone,
}: DateTimePartsArgs): DateTimeParts => {
  const dateObj = useMemo(() => {
    if (!date) return null;
    return date instanceof Date ? date : new Date(date);
  }, [date]);

  return useMemo(() => {
    if (!isValidDate(dateObj)) {
      return { dateObj: null, formattedDate: null, formattedTime: null, fullDateTime: null };
    }

    const withTime = hasTimeOfDay(dateObj);

    return {
      dateObj,
      formattedDate: formatDatePart(dateObj, dateFormat),
      formattedTime: withTime ? formatTimePart(dateObj, timeFormat, showTimezone) : null,
      fullDateTime: longForm(dateObj, withTime),
    };
  }, [dateObj, dateFormat, timeFormat, showTimezone]);
};
