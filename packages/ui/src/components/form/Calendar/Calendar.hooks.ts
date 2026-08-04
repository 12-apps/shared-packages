import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addMonths, generateMonthMatrix, getWeekdayNames, normalizeDate } from './Calendar.dates';
import { ACTIVATION_KEYS, navigateFocus } from './Calendar.keyboard';
import { isDateDisabledBy, nextRangeStep } from './Calendar.selection';
import type { MonthMatrix, ResolvedCalendarProps } from './Calendar.types';

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

// Which day the calendar opens on: whatever is already chosen, else today.
const initialFocus = (props: ResolvedCalendarProps, today: Date): Date => {
  if (props.selectionMode === 'single' && props.value) return normalizeDate(props.value);
  if (props.selectionMode === 'range' && props.range.start) return normalizeDate(props.range.start);
  return today;
};

const useCalendarState = (props: ResolvedCalendarProps, today: Date) => {
  const [focusedDate, setFocusedDate] = useState<Date>(() => initialFocus(props, today));
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(focusedDate));

  return {
    focusedDate,
    setFocusedDate,
    hoveredDate,
    setHoveredDate,
    currentMonth,
    setCurrentMonth,
  };
};

const useAutoFocusGrid = (autoFocus: boolean) => {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus && gridRef.current) gridRef.current.focus();
  }, [autoFocus]);

  return gridRef;
};

const useVisibleMonths = ({
  currentMonth,
  monthsToShow,
  firstDayOfWeek,
}: {
  currentMonth: Date;
  monthsToShow: number;
  firstDayOfWeek: number;
}): MonthMatrix[] =>
  useMemo(() => {
    const matrices: MonthMatrix[] = [];
    let cursor = currentMonth;

    for (let i = 0; i < monthsToShow; i++) {
      matrices.push(generateMonthMatrix(cursor.getMonth(), cursor.getFullYear(), firstDayOfWeek));
      cursor = addMonths(cursor, 1);
    }

    return matrices;
  }, [currentMonth, monthsToShow, firstDayOfWeek]);

// A click either sets a single date or advances the range by one step; the range
// rules themselves live in nextRangeStep.
const useDateClick = ({
  props,
  isDisabled,
  setFocusedDate,
}: {
  props: ResolvedCalendarProps;
  isDisabled: (date: Date) => boolean;
  setFocusedDate: (date: Date) => void;
}) => {
  const {
    selectionMode,
    range,
    onChange,
    onRangeChange,
    onIntermediateRangeChange,
    allowSameDayRange,
    minRangeLength,
    maxRangeLength,
  } = props;

  return useCallback(
    (date: Date) => {
      if (isDisabled(date)) return;

      const candidate = normalizeDate(date);
      setFocusedDate(candidate);

      if (selectionMode === 'single') {
        onChange?.(candidate);
        return;
      }

      const step = nextRangeStep({
        start: range.start,
        end: range.end,
        candidate,
        allowSameDayRange,
        minRangeLength,
        maxRangeLength,
      });

      if (step.kind === 'rejected') return;

      if (step.kind === 'complete') onRangeChange?.(step.range);
      onIntermediateRangeChange?.(step.range);
    },
    [
      selectionMode,
      range,
      onChange,
      onRangeChange,
      onIntermediateRangeChange,
      isDisabled,
      allowSameDayRange,
      minRangeLength,
      maxRangeLength,
      setFocusedDate,
    ],
  );
};

// Hovering only means something while a range is half-chosen.
const useHoverHandlers = ({
  selectionMode,
  range,
  isDisabled,
  setHoveredDate,
}: {
  selectionMode: ResolvedCalendarProps['selectionMode'];
  range: ResolvedCalendarProps['range'];
  isDisabled: (date: Date) => boolean;
  setHoveredDate: (date: Date | null) => void;
}) => {
  const handleDateMouseEnter = useCallback(
    (date: Date) => {
      if (selectionMode === 'range' && range.start && !range.end && !isDisabled(date)) {
        setHoveredDate(normalizeDate(date));
      }
    },
    [selectionMode, range, isDisabled, setHoveredDate],
  );

  const handleDateMouseLeave = useCallback(() => setHoveredDate(null), [setHoveredDate]);

  return { handleDateMouseEnter, handleDateMouseLeave };
};

const useKeyboardHandler = ({
  focusedDate,
  firstDayOfWeek,
  currentMonth,
  handleDateClick,
  setFocusedDate,
  setCurrentMonth,
  setHoveredDate,
}: {
  focusedDate: Date;
  firstDayOfWeek: number;
  currentMonth: Date;
  handleDateClick: (date: Date) => void;
  setFocusedDate: (date: Date) => void;
  setCurrentMonth: (date: Date) => void;
  setHoveredDate: (date: Date | null) => void;
}) =>
  useCallback(
    (event: React.KeyboardEvent) => {
      const { key } = event;
      const moved = navigateFocus(key, focusedDate, { firstDayOfWeek, shiftKey: event.shiftKey });

      if (moved) {
        event.preventDefault();
        setFocusedDate(normalizeDate(moved));

        // Follow focus into a month that is not on screen.
        const month = startOfMonth(moved);
        if (month.getTime() !== currentMonth.getTime()) setCurrentMonth(month);
        return;
      }

      if (ACTIVATION_KEYS.includes(key)) {
        event.preventDefault();
        handleDateClick(focusedDate);
        return;
      }

      if (key === 'Escape') {
        event.preventDefault();
        setHoveredDate(null);
      }
    },
    [
      focusedDate,
      firstDayOfWeek,
      currentMonth,
      handleDateClick,
      setFocusedDate,
      setCurrentMonth,
      setHoveredDate,
    ],
  );

export const useCalendar = (props: ResolvedCalendarProps) => {
  const { monthsToShow, firstDayOfWeek, locale, minDate, maxDate, isDateDisabled } = props;

  const today = useMemo(() => normalizeDate(new Date()), []);
  const state = useCalendarState(props, today);
  const gridRef = useAutoFocusGrid(props.autoFocus);

  const monthMatrices = useVisibleMonths({
    currentMonth: state.currentMonth,
    monthsToShow,
    firstDayOfWeek,
  });

  const weekdayNames = useMemo(
    () => getWeekdayNames(locale, firstDayOfWeek),
    [locale, firstDayOfWeek],
  );

  const isDisabled = useCallback(
    (date: Date) => isDateDisabledBy({ date, minDate, maxDate, isDateDisabled }),
    [minDate, maxDate, isDateDisabled],
  );

  const { setCurrentMonth } = state;
  const goToPreviousMonth = useCallback(
    () => setCurrentMonth((prev) => addMonths(prev, -1)),
    [setCurrentMonth],
  );
  const goToNextMonth = useCallback(
    () => setCurrentMonth((prev) => addMonths(prev, 1)),
    [setCurrentMonth],
  );

  const handleDateClick = useDateClick({
    props,
    isDisabled,
    setFocusedDate: state.setFocusedDate,
  });

  const { handleDateMouseEnter, handleDateMouseLeave } = useHoverHandlers({
    selectionMode: props.selectionMode,
    range: props.range,
    isDisabled,
    setHoveredDate: state.setHoveredDate,
  });

  const handleKeyDown = useKeyboardHandler({
    focusedDate: state.focusedDate,
    firstDayOfWeek,
    currentMonth: state.currentMonth,
    handleDateClick,
    setFocusedDate: state.setFocusedDate,
    setCurrentMonth: state.setCurrentMonth,
    setHoveredDate: state.setHoveredDate,
  });

  return {
    gridRef,
    today,
    focusedDate: state.focusedDate,
    hoveredDate: state.hoveredDate,
    monthMatrices,
    weekdayNames,
    isDisabled,
    goToPreviousMonth,
    goToNextMonth,
    handleDateClick,
    handleDateMouseEnter,
    handleDateMouseLeave,
    handleKeyDown,
  };
};
