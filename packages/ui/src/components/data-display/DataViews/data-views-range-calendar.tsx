'use client';

/**
 * The range calendar under a day filter's `De`/`Até` boxes (FUT-4144).
 *
 * The owner picked it ALWAYS OPEN (option B of the prototype): a period is
 * three taps — open the filter, the first day, the last day — against five for
 * a calendar button in each box and four for a link to a separate sheet. It
 * sits BELOW the boxes, with no button of its own, so the typed path is not one
 * keystroke longer than it was.
 *
 * The boxes and the calendar are two views of ONE range: a tap writes the
 * boxes, a typed day moves and repaints the calendar, an impossible typed day
 * (which writes nothing) leaves it alone, and "Limpar" empties both.
 *
 * It is `Calendar` in `selectionMode="range"`, the same one `DateRangePicker`
 * mounts — not a second calendar. Its own rule picks the period: the first tap
 * starts it, the second closes it, and a second tap BEFORE the first swaps the
 * two, so the boxes never show a period backwards.
 */
import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import React from 'react';

import { EN_US_DATA_VIEWS_COPY } from '../../../en-US.data-display';
import type { Theme } from '@mui/material/styles/index.js';
import { rem, sxRem } from '../../../tokens/relative';
import { Calendar, type DateRange } from '../../form/Calendar';
import { toDayString, toLocalDay } from '../../form/DateRangePicker/DateRangePicker.dates';
import type { DataViewsDayCalendarCopy } from './data-views-copy';
import { useDataViewsCopy } from './data-views-copy-context';
import type { RangeValue } from './data-views-types';

const CALENDAR_CLASS = 'data-views-range-calendar';

/**
 * `Calendar` draws its own `Paper` with 24px of padding and a shadow. Inside
 * the filter's popover that reads as a card inside a card, so the inner frame
 * is flattened through the class hook the component offers for this — the
 * same thing `DateRangePicker` does.
 */
const ROOT_SX = (theme: Theme) => ({
  mt: { xs: 1, sm: 1.5 },
  // Below `sm` the caption and the weekday row give up their bottom margins,
  // so the whole popover fits a 320×568 screen under its pill (FUT-4144).
  '& :has(> * > [data-testid="calendar-month-select"])': { mb: { xs: 0.5, sm: 2 } },
  '& :has(> [role="columnheader"])': { mb: { xs: 0, sm: 1 } },
  '& [role="columnheader"]': { height: { xs: rem(theme, 24), sm: rem(theme, 32) } },
  // No gaps between days: the seven columns are what a day's 40px target is
  // carved from, and at 320 the 4px column gaps were the difference between
  // 40 and 37; the row gaps were the 20px that pushed the last week under the
  // "Mais" panel's edge at 320×568 (FUT-4144 UI review). A period then reads
  // as one unbroken band.
  '& [role="grid"], & :has(> [role="columnheader"])': { gap: 0 },
  // With no gaps a rounded day in the middle of a period leaves a notch of
  // background at every corner; the middle is square, the two ends keep theirs.
  '& .calendar-day.in-range': { borderRadius: 0 },
  // The month/year caption on ONE row at 320: the selectors give up the slack
  // around their text before the arrows are pushed onto a second row.
  '& [data-testid="calendar-month-select"], & [data-testid="calendar-year-select"]': { px: 0.5, minWidth: 0 },
  [`& .${CALENDAR_CLASS}`]: {
    p: 0,
    boxShadow: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    // A tapped day already rings itself; the whole grid framed in the primary
    // colour after every tap is noise in a popover. The frame stays for the
    // keyboard reaching the grid itself.
    '&:focus-within': { outline: 'none' },
    '&:focus-visible': {
      outline: (theme: Theme) => `${rem(theme, 2)} solid`,
      outlineColor: 'primary.main',
      outlineOffset: sxRem(2),
    },
  },
});

/** The two ends of a range, as `Calendar` reads them. */
function rangeOf(value: RangeValue): DateRange {
  return {
    start: toLocalDay(typeof value.min === 'string' ? value.min : null),
    end: toLocalDay(typeof value.max === 'string' ? value.max : null),
  };
}

/**
 * What a tap on the calendar makes of the range.
 *
 * `Calendar` reports the period it holds after the tap: a fresh start (`end`
 * null) or a closed one, already in order. The one case it cannot see is a
 * range with only `Até` — typed, or left by a saved view — where its first tap
 * would drop that `Até`. A first day on or before it keeps it, so "até 15/10"
 * plus one tap on the 3rd is 03/10–15/10, as the prototype does.
 */
export function rangeFromCalendar(previous: RangeValue, picked: DateRange): RangeValue {
  const min = dayOf(picked.start);
  const max = dayOf(picked.end) ?? keptEnd(previous, min);
  return { ...(min ? { min } : {}), ...(max ? { max } : {}) };
}

const dayOf = (date: Date | null | undefined): string | undefined => (date ? toDayString(date) : undefined);

/** The `Até` of a range that has ONLY one, when the new first day is on or before it. */
function keptEnd(previous: RangeValue, min: string | undefined): string | undefined {
  if (previous.min != null || typeof previous.max !== 'string') return undefined;
  return min && min <= previous.max ? previous.max : undefined;
}

/**
 * The month the calendar opens on while `De` is empty. With `De` set it opens
 * on De's month, which `Calendar` does by itself.
 *
 * With two months the current month sits on the RIGHT (setembro | outubro), so
 * the days a filter usually asks about — the ones just past — are on screen;
 * with only `Até` set, its month takes that place.
 */
function openingMonth(value: RangeValue, months: number): Date | undefined {
  const end = toLocalDay(typeof value.max === 'string' ? value.max : null);
  const anchor = end ?? new Date();
  return new Date(anchor.getFullYear(), anchor.getMonth() - (months > 1 ? 1 : 0), 1);
}

/** Props of {@link DayRangeCalendar}. */
export interface DayRangeCalendarProps {
  /** The filter's own label ("Data"), which names the calendar. */
  fieldLabel: string;
  value: RangeValue;
  /** Called with the range a tap leaves; never for a typed day. */
  onChange: (range: RangeValue) => void;
  /**
   * Months side by side. Two read as a period at a glance where there is room;
   * one, with the month/year selectors, where there is not.
   */
  months: 1 | 2;
  /**
   * Changes when the range moved from OUTSIDE the calendar (typed, a preset,
   * "Limpar"), so the calendar re-opens on it. Never for its own taps: a
   * calendar that jumped under the finger picking in it would be unusable.
   */
  viewKey: string;
  testId: string;
}

export function DayRangeCalendar({
  fieldLabel,
  value,
  onChange,
  months,
  viewKey,
  testId,
}: DayRangeCalendarProps): React.JSX.Element {
  const copy: DataViewsDayCalendarCopy =
    useDataViewsCopy().filters.dayCalendar ?? (EN_US_DATA_VIEWS_COPY.filters.dayCalendar as DataViewsDayCalendarCopy);
  const range = rangeOf(value);
  const pick = (picked: DateRange) => onChange(rangeFromCalendar(value, picked));
  const waitingForEnd = Boolean(range.start && !range.end);

  return (
    <Box sx={ROOT_SX} data-testid={`${testId}-calendar`}>
      <Calendar
        key={viewKey}
        ariaLabel={copy.label(fieldLabel)}
        className={CALENDAR_CLASS}
        selectionMode="range"
        locale={copy.locale}
        labels={copy.caption}
        // Sunday first, as a pt-BR calendar reads (`D S T Q Q S S`) and as the
        // presets' "Esta semana" counts.
        firstDayOfWeek={0}
        numberOfMonths={months}
        // Side by side, a day of the next month in this one is the same day
        // twice; one month alone keeps them, muted, as a six-week frame.
        showOutsideDays={months === 1}
        captionLayout={months > 1 ? 'arrows' : 'selectors'}
        defaultMonth={openingMonth(value, months)}
        range={range}
        // The intermediate callback does the work: the other fires only on the
        // tap that CLOSES a period, so the first tap would write nothing.
        onIntermediateRangeChange={pick}
      />
      <Typography
        component="p"
        aria-live="polite"
        data-testid={`${testId}-calendar-hint`}
        sx={{ mt: { xs: 0.25, sm: 1 }, fontSize: sxRem(12), color: 'text.secondary' }}
      >
        {waitingForEnd ? copy.pickEnd : copy.pickStart}
      </Typography>
    </Box>
  );
}
