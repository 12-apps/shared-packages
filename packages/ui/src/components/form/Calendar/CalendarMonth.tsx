import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { FC } from 'react';
import React from 'react';

import type { CalendarLabels } from '../../../copy/labels';
import { sxRem } from '../../../tokens/relative';

import { getMonthName } from './Calendar.dates';
import type { CalendarProps, MonthMatrix } from './Calendar.types';
import type { DayCellContext } from './CalendarDayCell';
import { CalendarDayCell } from './CalendarDayCell';

/** The nav spacer's width and the weekday row's height, 32 design px through the type scale. */
const SPACER_WIDTH = sxRem(32);

// `minmax(0, 1fr)`, not `1fr`: a bare `1fr` keeps each column at least its
// content's width, which is what held the grid at 304px (FUT-3861). No column
// gap: a selected range is one band across the days, and a gap cut it into
// tiles (FUT-4162). Rows keep theirs. Items centre in their column: the built-in
// day stretches across it, a host's `renderDay` cell sits in its middle.
const GRID_SX = {
  display: 'grid',
  justifyItems: 'center',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  columnGap: 0,
  rowGap: 0.5,
} as const;

/**
 * A month takes the room it is given, from nothing up to seven full columns
 * (304 design px: what 7 × 40 cells and 6 × 4 gaps came to before the gaps
 * went, FUT-4162). Months side by side keep a 280 basis,
 * so a multi-month calendar still wraps rather than squeezing every month.
 */
export const MONTH_SX = { flex: `1 1 ${sxRem(280)}`, minWidth: 0, maxWidth: sxRem(304) } as const;

/** The two arrows' accessible names; an icon alone names nothing. */
export type MonthArrowLabels = Pick<CalendarLabels, 'previousMonth' | 'nextMonth'>;

// Only the outermost months carry arrows; the ones between get a spacer so their
// titles stay centred.
const MonthNavHeader: FC<{
  title: React.ReactNode;
  showPrevious: boolean;
  showNext: boolean;
  labels?: MonthArrowLabels;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}> = ({ title, showPrevious, showNext, labels, onPreviousMonth, onNextMonth }) => (
  <Box
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
    data-testid="calendar-header"
  >
    {showPrevious && (
      <IconButton
        onClick={onPreviousMonth}
        size="small"
        aria-label={labels?.previousMonth}
        data-testid="calendar-prev-month"
      >
        <ChevronLeft />
      </IconButton>
    )}

    <Typography
      variant="h6"
      component="h2"
      sx={{ fontWeight: 'bold', flex: 1, textAlign: 'center' }}
    >
      {title}
    </Typography>

    {showNext && (
      <IconButton
        onClick={onNextMonth}
        size="small"
        aria-label={labels?.nextMonth}
        data-testid="calendar-next-month"
      >
        <ChevronRight />
      </IconButton>
    )}

    {!showPrevious && !showNext && <Box sx={{ width: SPACER_WIDTH }} />}
  </Box>
);

const WeekdayHeader: FC<{ weekdayNames: string[] }> = ({ weekdayNames }) => (
  <Box sx={{ ...GRID_SX, mb: 1 }}>
    {weekdayNames.map((weekday, index) => (
      <Box
        // Narrow weekday names repeat within a week ('S', 'T'), so position is
        // the only stable key here.
        key={`weekday-${index}`}
        role="columnheader"
        data-testid={`calendar-weekday-${index}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: SPACER_WIDTH,
          fontSize: sxRem(14),
          fontWeight: 'bold',
          color: 'text.secondary',
        }}
      >
        {weekday}
      </Box>
    ))}
  </Box>
);

/** The weekday row and the day grid under a month's caption. */
export const MonthDays: FC<{
  matrix: MonthMatrix;
  monthIndex: number;
  weekdayNames: string[];
  dayContext: DayCellContext;
}> = ({ matrix, weekdayNames, dayContext }) => (
  <>
    <WeekdayHeader weekdayNames={weekdayNames} />

    <Box
      role="grid"
      // Named by its month in words. It pointed at an id nothing carried, so
      // the grid had no name at all and a two-month calendar read as two
      // anonymous grids.
      aria-label={getMonthName(matrix.month, matrix.year, dayContext.locale)}
      data-testid="calendar-grid"
      sx={GRID_SX}
    >
      {matrix.weeks.flat().map((day) => (
        <CalendarDayCell key={day.key} day={day} {...dayContext} />
      ))}
    </Box>
  </>
);

export interface CalendarMonthProps {
  matrix: MonthMatrix;
  monthIndex: number;
  monthsToShow: number;
  locale: string;
  weekdayNames: string[];
  renderHeader?: CalendarProps['renderHeader'];
  /** The arrows' accessible names. */
  labels?: MonthArrowLabels;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  dayContext: DayCellContext;
}

export const CalendarMonth: FC<CalendarMonthProps> = ({
  matrix,
  monthIndex,
  monthsToShow,
  locale,
  weekdayNames,
  renderHeader,
  labels,
  onPreviousMonth,
  onNextMonth,
  dayContext,
}) => {
  const monthName = getMonthName(matrix.month, matrix.year, locale);
  const title = renderHeader ? renderHeader({ month: matrix.month, year: matrix.year }) : monthName;

  return (
    /* The month is addressable by its position, because in a multi-month
       calendar every day number appears once PER MONTH — `calendar-date-5` is
       January's 5th and February's. Without a per-month hook a test can only
       reach a day positionally, which is exactly what the flakiness gate
       refuses. Additive: `calendar-grid` below is unchanged. */
    <Box sx={MONTH_SX} data-testid={`calendar-month-${monthIndex}`}>
      <MonthNavHeader
        title={title}
        showPrevious={monthIndex === 0}
        showNext={monthIndex === monthsToShow - 1}
        labels={labels}
        onPreviousMonth={onPreviousMonth}
        onNextMonth={onNextMonth}
      />

      <MonthDays
        matrix={matrix}
        monthIndex={monthIndex}
        weekdayNames={weekdayNames}
        dayContext={dayContext}
      />
    </Box>
  );
};
