import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { FC } from 'react';
import React from 'react';

import type { CalendarLabels } from '../../../copy/labels';
import type { Theme } from '@mui/material/styles/index.js';
import { rem, sxRem } from '../../../tokens/relative';

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

/**
 * A filling month (`fullWidth`) drops the 304 ceiling and takes its share of
 * the row; its columns spread, its day faces do not grow (`CalendarDay`).
 */
export const monthSx = (fullWidth: boolean) => (fullWidth ? FILL_MONTH_SX : MONTH_SX);

/**
 * The basis as a theme function: interpolated into a string, `sxRem` is a
 * function and the whole `flex` value is dropped as invalid CSS. A filling
 * month's cells have no intrinsic width to fall back on, so it must grow.
 */
const FILL_MONTH_SX = {
  flex: (theme: Theme) => `1 1 ${rem(theme, 280)}`,
  minWidth: 0,
  maxWidth: 'none',
} as const;

/**
 * The caption as a title: its first letter upper-cased in the calendar's own
 * language ("novembro de 2026" → "Novembro de 2026"), as a heading reads in
 * pt-BR; `Intl` writes month names lower-case there. The caption only — the
 * grid's name and a day's name keep `Intl`'s words, which a sentence quotes.
 */
export const captionOf = (monthName: string, locale: string): string => {
  const [first = '', ...rest] = [...monthName];
  return `${first.toLocaleUpperCase(locale)}${rest.join('')}`;
};

/** The two arrows' accessible names; an icon alone names nothing. */
export type MonthArrowLabels = Pick<CalendarLabels, 'previousMonth' | 'nextMonth'>;

// Only the outermost months carry arrows; the ones between get a spacer so their
// titles stay centred.
const MonthNavHeader: FC<{
  title: React.ReactNode;
  showPrevious: boolean;
  showNext: boolean;
  labels?: MonthArrowLabels;
  disabled: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}> = ({ title, showPrevious, showNext, labels, disabled, onPreviousMonth, onNextMonth }) => (
  <Box
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
    data-testid="calendar-header"
  >
    {showPrevious && (
      <IconButton
        onClick={onPreviousMonth}
        disabled={disabled}
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
        disabled={disabled}
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
  /** `CalendarProps.navigationDisabled`. */
  navigationDisabled?: boolean;
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
  navigationDisabled = false,
  onPreviousMonth,
  onNextMonth,
  dayContext,
}) => {
  const title = renderHeader
    ? renderHeader({ month: matrix.month, year: matrix.year })
    : captionOf(getMonthName(matrix.month, matrix.year, locale), locale);

  return (
    /* The month is addressable by its position, because in a multi-month
       calendar every day number appears once PER MONTH — `calendar-date-5` is
       January's 5th and February's. Without a per-month hook a test can only
       reach a day positionally, which is exactly what the flakiness gate
       refuses. Additive: `calendar-grid` below is unchanged. */
    <Box sx={monthSx(dayContext.fullWidth)} data-testid={`calendar-month-${monthIndex}`}>
      <MonthNavHeader
        title={title}
        showPrevious={monthIndex === 0}
        showNext={monthIndex === monthsToShow - 1}
        labels={labels}
        disabled={navigationDisabled}
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
