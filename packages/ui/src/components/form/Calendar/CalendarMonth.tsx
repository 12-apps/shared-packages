import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { Box, IconButton, Typography } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import { getMonthName } from './Calendar.dates';
import type { CalendarProps, MonthMatrix } from './Calendar.types';
import type { DayCellContext } from './CalendarDayCell';
import { CalendarDayCell } from './CalendarDayCell';

const SPACER_WIDTH = 32;

const GRID_SX = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 } as const;

// Only the outermost months carry arrows; the ones between get a spacer so their
// titles stay centred.
const MonthNavHeader: FC<{
  title: React.ReactNode;
  showPrevious: boolean;
  showNext: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}> = ({ title, showPrevious, showNext, onPreviousMonth, onNextMonth }) => (
  <Box
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
    data-testid="calendar-header"
  >
    {showPrevious && (
      <IconButton onClick={onPreviousMonth} size="small" data-testid="calendar-prev-month">
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
      <IconButton onClick={onNextMonth} size="small" data-testid="calendar-next-month">
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
          fontSize: '0.875rem',
          fontWeight: 'bold',
          color: 'text.secondary',
        }}
      >
        {weekday}
      </Box>
    ))}
  </Box>
);

export interface CalendarMonthProps {
  matrix: MonthMatrix;
  monthIndex: number;
  monthsToShow: number;
  locale: string;
  weekdayNames: string[];
  renderHeader?: CalendarProps['renderHeader'];
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
    <Box sx={{ minWidth: 280 }} data-testid={`calendar-month-${monthIndex}`}>
      <MonthNavHeader
        title={title}
        showPrevious={monthIndex === 0}
        showNext={monthIndex === monthsToShow - 1}
        onPreviousMonth={onPreviousMonth}
        onNextMonth={onNextMonth}
      />

      <WeekdayHeader weekdayNames={weekdayNames} />

      <Box
        role="grid"
        aria-labelledby={`month-${monthIndex}`}
        data-testid="calendar-grid"
        sx={GRID_SX}
      >
        {matrix.weeks.flat().map((day) => (
          <CalendarDayCell key={day.key} day={day} {...dayContext} />
        ))}
      </Box>
    </Box>
  );
};
