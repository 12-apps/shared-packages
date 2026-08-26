import type { SxProps, Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import React from 'react';

import { resolveCalendarProps } from './Calendar.helpers';
import { useCalendar } from './Calendar.hooks';
import type { CalendarProps } from './Calendar.types';
import type { DayCellContext } from './CalendarDayCell';
import { CalendarMonth } from './CalendarMonth';

const containerSx = (monthsToShow: number): SxProps<Theme> => ({
  p: 3,
  display: 'flex',
  flexDirection: monthsToShow > 1 ? 'row' : 'column',
  gap: 3,
  outline: 'none',
  '&:focus-within': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 2,
  },
});

export const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>((componentProps, ref) => {
  const props = resolveCalendarProps(componentProps);
  const { monthsToShow, locale, renderHeader, renderFooter, className, ariaLabel } = props;

  const calendar = useCalendar(props);

  const dayContext: DayCellContext = {
    selectionMode: props.selectionMode,
    value: props.value,
    range: props.range,
    showOutsideDays: props.showOutsideDays,
    renderDay: props.renderDay,
    dayClassName: props.dayClassName,
    hoveredDate: calendar.hoveredDate,
    focusedDate: calendar.focusedDate,
    today: calendar.today,
    isDisabled: calendar.isDisabled,
    onSelect: calendar.handleDateClick,
    onHover: calendar.handleDateMouseEnter,
    onHoverEnd: calendar.handleDateMouseLeave,
  };

  return (
    <Paper
      ref={ref}
      className={className}
      role="application"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={calendar.handleKeyDown}
      data-testid="calendar-container"
      sx={containerSx(monthsToShow)}
    >
      <Box ref={calendar.gridRef} sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {calendar.monthMatrices.map((matrix, index) => (
          <CalendarMonth
            key={`month-${matrix.year}-${matrix.month}`}
            matrix={matrix}
            monthIndex={index}
            monthsToShow={monthsToShow}
            locale={locale}
            weekdayNames={calendar.weekdayNames}
            renderHeader={renderHeader}
            onPreviousMonth={calendar.goToPreviousMonth}
            onNextMonth={calendar.goToNextMonth}
            dayContext={dayContext}
          />
        ))}
      </Box>

      {renderFooter && (
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>{renderFooter}</Box>
      )}
    </Paper>
  );
});

Calendar.displayName = 'Calendar';

export default Calendar;
