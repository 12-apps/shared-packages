import type { SxProps, Theme } from '@mui/material/styles/index.js';
import Box from '@mui/material/Box/index.js';
import Paper from '@mui/material/Paper/index.js';
import React, { useCallback, useRef } from 'react';

import { EN_US_UI_LABELS } from '../../../en-US.labels';
import { rem, sxRem } from '../../../tokens/relative';
import { resolveLabels } from '../../../utils/resolve-labels';

import { resolveCalendarProps } from './Calendar.helpers';
import { useCalendar } from './Calendar.hooks';
import { useCalendarPicker } from './Calendar.picker';
import type { CalendarProps, ResolvedCalendarProps } from './Calendar.types';
import type { DayCellContext } from './CalendarDayCell';
import { CalendarMonth } from './CalendarMonth';
import { CalendarSelectorsMonth } from './CalendarSelectorsMonth';

const containerSx = (monthsToShow: number): SxProps<Theme> => ({
  p: 3,
  display: 'flex',
  flexDirection: monthsToShow > 1 ? 'row' : 'column',
  gap: 3,
  outline: 'none',
  '&:focus-within': {
    outline: (theme: Theme) => `${rem(theme, 2)} solid`,
    outlineColor: 'primary.main',
    outlineOffset: sxRem(2),
  },
});

type CalendarState = ReturnType<typeof useCalendar>;

const buildDayContext = (props: ResolvedCalendarProps, calendar: CalendarState): DayCellContext => ({
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
});

// The container is the forwarded ref's AND the picker's: focus falls back to it.
const useRootRef = (forwarded: React.ForwardedRef<HTMLDivElement>) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [forwarded],
  );
  return { rootRef, setRoot };
};

export const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>((componentProps, ref) => {
  const props = resolveCalendarProps(componentProps);
  const { monthsToShow, locale, renderHeader, renderFooter, className, ariaLabel } = props;

  const calendar = useCalendar(props);
  const { rootRef, setRoot } = useRootRef(ref);
  const bounds = { minDate: props.minDate, maxDate: props.maxDate };
  const picker = useCalendarPicker({ rootRef, bounds, ...calendar });
  const dayContext = buildDayContext(props, calendar);
  // The selectors caption always resolves to one month (see the helpers).
  const firstMonth = calendar.monthMatrices[0];

  return (
    <Paper
      ref={setRoot}
      className={className}
      role="application"
      aria-label={ariaLabel}
      tabIndex={0}
      // The day keys belong to the days: with a month or year grid open there
      // is no focused day on screen to move.
      onKeyDown={picker.view === 'days' ? calendar.handleKeyDown : undefined}
      data-testid="calendar-container"
      sx={containerSx(monthsToShow)}
    >
      <Box ref={calendar.gridRef} sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {props.captionLayout === 'selectors' && firstMonth ? (
          <CalendarSelectorsMonth
            matrix={firstMonth}
            locale={locale}
            weekdayNames={calendar.weekdayNames}
            dayContext={dayContext}
            bounds={bounds}
            labels={resolveLabels(EN_US_UI_LABELS.calendar, props.labels)}
            picker={picker}
            onPreviousMonth={() => {
              picker.showDays();
              calendar.goToPreviousMonth();
            }}
            onNextMonth={() => {
              picker.showDays();
              calendar.goToNextMonth();
            }}
          />
        ) : (
          calendar.monthMatrices.map((matrix, index) => (
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
          ))
        )}
      </Box>

      {renderFooter && (
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>{renderFooter}</Box>
      )}
    </Paper>
  );
});

Calendar.displayName = 'Calendar';

export default Calendar;
