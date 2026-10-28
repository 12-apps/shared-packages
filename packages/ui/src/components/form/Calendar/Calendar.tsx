import type { SxProps, Theme } from '@mui/material/styles/index.js';
import Box from '@mui/material/Box/index.js';
import Paper from '@mui/material/Paper/index.js';
import React, { useCallback, useEffect, useRef } from 'react';

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
  locale: props.locale,
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

/**
 * Keeps the keyboard's place visible when it is on a DAY.
 *
 * The arrows move the grid's one tab stop (`focusedDate`), and that is enough
 * while the container holds focus. But a reader who tabbed onto a day, or
 * clicked one, has focus on that day's button: the tab stop moved and focus
 * stayed behind on a cell that is no longer it, so the ring sat on the old day
 * and a month change unmounted it under the reader. Focus now follows the
 * tab stop whenever the key that moved it was pressed ON a day.
 */
const useFollowDayFocus = (rootRef: React.RefObject<HTMLDivElement | null>, focusedDate: Date) => {
  const onDay = useRef(false);
  useEffect(() => {
    if (!onDay.current) return;
    onDay.current = false;
    rootRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
  }, [rootRef, focusedDate]);
  return (event: React.KeyboardEvent) => {
    onDay.current = (event.target as HTMLElement).getAttribute('role') === 'gridcell';
  };
};

export const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>((componentProps, ref) => {
  const props = resolveCalendarProps(componentProps);
  const { monthsToShow, locale, renderHeader, renderFooter, className, ariaLabel } = props;

  const calendar = useCalendar(props);
  const { rootRef, setRoot } = useRootRef(ref);
  const bounds = { minDate: props.minDate, maxDate: props.maxDate };
  const picker = useCalendarPicker({ rootRef, bounds, ...calendar });
  const dayContext = buildDayContext(props, calendar);
  const noteKeyTarget = useFollowDayFocus(rootRef, calendar.focusedDate);
  const labels = resolveLabels(EN_US_UI_LABELS.calendar, props.labels);
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
      onKeyDown={
        picker.view === 'days'
          ? (event) => {
              noteKeyTarget(event);
              calendar.handleKeyDown(event);
            }
          : undefined
      }
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
            labels={labels}
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
              // Only a host that passed `labels` gets named arrows: without
              // them the arrows caption stays exactly as it always was.
              labels={props.labels ? labels : undefined}
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
