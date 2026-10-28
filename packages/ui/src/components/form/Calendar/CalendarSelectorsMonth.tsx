import Box from '@mui/material/Box/index.js';
import type { FC } from 'react';
import React, { useId } from 'react';

import type { CalendarLabels } from '../../../copy/labels';

import { getMonthLabel } from './Calendar.dates';
import type { CalendarPicker } from './Calendar.picker';
import type { MonthMatrix } from './Calendar.types';
import type { DateBounds } from './Calendar.views';
import { MONTH_INDEXES, canShiftMonth, isMonthOutOfBounds, isYearOutOfBounds, yearOptions } from './Calendar.views';
import type { DayCellContext } from './CalendarDayCell';
import { MONTH_SX, MonthDays } from './CalendarMonth';
import type { PickerOption } from './CalendarPickerGrid';
import { CalendarPickerGrid } from './CalendarPickerGrid';
import { CalendarSelectorsCaption } from './CalendarSelectorsCaption';

/** The days and the open grid share one cell, so opening a grid never resizes the calendar. */
const BODY_SX = { display: 'grid' } as const;

/** Adds no height of its own; a long year list scrolls inside the days' height. */
const PICKER_SLOT_SX = {
  gridArea: '1 / 1',
  height: 0,
  minHeight: '100%',
} as const;

const YEAR_COLUMNS = 4;
const MONTH_COLUMNS = 3;

export interface CalendarSelectorsMonthProps {
  matrix: MonthMatrix;
  locale: string;
  weekdayNames: string[];
  dayContext: DayCellContext;
  bounds: DateBounds;
  labels: CalendarLabels;
  picker: CalendarPicker;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

const monthOptions = ({ year, month }: MonthMatrix, locale: string, bounds: DateBounds): PickerOption[] =>
  MONTH_INDEXES.map((index) => ({
    value: index,
    label: getMonthLabel(index, locale, 'short'),
    ariaLabel: getMonthLabel(index, locale, 'long'),
    disabled: isMonthOutOfBounds(year, index, bounds),
    current: index === month,
  }));

// The list is cut at the bounds' years, so only a shown year outside them is
// disabled.
const yearPickerOptions = ({ year }: MonthMatrix, bounds: DateBounds): PickerOption[] =>
  yearOptions(bounds, year).map((option) => ({
    value: option,
    label: String(option),
    disabled: isYearOutOfBounds(option, bounds),
    current: option === year,
  }));

/**
 * The one month of `captionLayout="selectors"`: the month/year caption over the
 * days, or over the month or year grid that stands in for them.
 */
export const CalendarSelectorsMonth: FC<CalendarSelectorsMonthProps> = ({
  matrix,
  locale,
  weekdayNames,
  dayContext,
  bounds,
  labels,
  picker,
  onPreviousMonth,
  onNextMonth,
}) => {
  const idPrefix = useId();
  const monthsId = `${idPrefix}-months`;
  const yearsId = `${idPrefix}-years`;
  const shown = new Date(matrix.year, matrix.month, 1);

  const picking = picker.view !== 'days';

  return (
    <Box sx={MONTH_SX} data-testid="calendar-month-0">
      <CalendarSelectorsCaption
        monthText={getMonthLabel(matrix.month, locale, 'long')}
        monthNames={MONTH_INDEXES.map((index) => getMonthLabel(index, locale, 'long'))}
        year={matrix.year}
        view={picker.view}
        labels={labels}
        monthsId={monthsId}
        yearsId={yearsId}
        canGoPrevious={canShiftMonth(shown, -1, bounds)}
        canGoNext={canShiftMonth(shown, 1, bounds)}
        onToggle={picker.toggle}
        onEscape={picker.dismiss}
        onPreviousMonth={onPreviousMonth}
        onNextMonth={onNextMonth}
      />

      <Box sx={BODY_SX}>
        {/* The days keep their place while a grid is open, so the calendar keeps their size at every density. */}
        <Box sx={{ gridArea: '1 / 1', visibility: picking ? 'hidden' : 'visible' }} data-testid="calendar-days">
          <MonthDays matrix={matrix} monthIndex={0} weekdayNames={weekdayNames} dayContext={dayContext} />
        </Box>
        {picking && (
          <Box sx={PICKER_SLOT_SX}>
            {picker.view === 'months' && (
              <CalendarPickerGrid
                id={monthsId}
                ariaLabel={labels.months}
                columns={MONTH_COLUMNS}
                options={monthOptions(matrix, locale, bounds)}
                testId="calendar-months"
                onPick={picker.pickMonth}
                onDismiss={picker.dismiss}
              />
            )}
            {picker.view === 'years' && (
              <CalendarPickerGrid
                id={yearsId}
                ariaLabel={labels.years}
                columns={YEAR_COLUMNS}
                options={yearPickerOptions(matrix, bounds)}
                testId="calendar-years"
                scrollable
                onPick={picker.pickYear}
                onDismiss={picker.dismiss}
              />
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
