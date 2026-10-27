import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CalendarView, DateBounds } from './Calendar.views';
import { clampMonthToBounds, landingDay } from './Calendar.views';

/** The day a keyboard user lands on after a pick: the grid's one tab stop. */
const FOCUSED_DAY = '[role="gridcell"][tabindex="0"]';

/** The selector a dismissed grid hands focus back to. */
const TOGGLE_OF: Record<Exclude<CalendarView, 'days'>, string> = {
  months: '[data-testid="calendar-month-select"]',
  years: '[data-testid="calendar-year-select"]',
};

interface CalendarPickerArgs {
  rootRef: React.RefObject<HTMLElement | null>;
  bounds: DateBounds;
  currentMonth: Date;
  focusedDate: Date;
  setCurrentMonth: (month: Date) => void;
  setFocusedDate: (date: Date) => void;
}

export interface CalendarPicker {
  view: CalendarView;
  /** Opens a pick grid, or goes back to the days when it is already open. */
  toggle: (view: Exclude<CalendarView, 'days'>) => void;
  pickYear: (year: number) => void;
  pickMonth: (month: number) => void;
  /** Back to the days with nothing changed (Escape), focus on the grid's own button. */
  dismiss: () => void;
  /** Back to the days, focus left where it is (a month arrow was used). */
  showDays: () => void;
}

/**
 * The month/year views of `captionLayout="selectors"`. A pick shows that month
 * and puts focus on its day grid, so the keyboard carries on where the eye
 * already is; a dismiss returns focus to the button that opened the grid.
 */
export const useCalendarPicker = ({
  rootRef,
  bounds,
  currentMonth,
  focusedDate,
  setCurrentMonth,
  setFocusedDate,
}: CalendarPickerArgs): CalendarPicker => {
  const [view, setView] = useState<CalendarView>('days');
  // Focus can only move once the next view is on screen, so a change of view
  // leaves a note for the effect below.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    pendingFocus.current = null;
    const root = rootRef.current;
    // A custom `renderDay` has no gridcell button: the container takes focus,
    // and the arrow keys still move the day from there.
    (root?.querySelector<HTMLElement>(selector) ?? root)?.focus();
  }, [view, rootRef]);

  const toggle = useCallback(
    (target: Exclude<CalendarView, 'days'>) => setView((current) => (current === target ? 'days' : target)),
    [],
  );

  const land = (year: number, month: number) => {
    setCurrentMonth(new Date(year, month, 1));
    setFocusedDate(landingDay(year, month, focusedDate.getDate(), bounds));
    pendingFocus.current = FOCUSED_DAY;
    setView('days');
  };

  const pickYear = (year: number) => land(year, clampMonthToBounds(year, currentMonth.getMonth(), bounds));
  const pickMonth = (month: number) => land(currentMonth.getFullYear(), month);

  const dismiss = () => {
    if (view === 'days') return;
    pendingFocus.current = TOGGLE_OF[view];
    setView('days');
  };

  const showDays = useCallback(() => setView('days'), []);

  return { view, toggle, pickYear, pickMonth, dismiss, showDays };
};
