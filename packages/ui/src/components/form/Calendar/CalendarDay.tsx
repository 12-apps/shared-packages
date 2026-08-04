import type { SxProps, Theme } from '@mui/material';
import { Box } from '@mui/material';
import type { FC } from 'react';
import React from 'react';

import type { DayRenderArgs } from './Calendar.types';

const CELL_SIZE = 40;

interface DayState extends DayRenderArgs {
  outside: boolean;
  focused: boolean;
}

// Order matters: these land on the element in the order listed.
const CLASS_FLAGS: Array<[keyof DayState, string]> = [
  ['selected', 'selected'],
  ['inRange', 'in-range'],
  ['rangeStart', 'range-start'],
  ['rangeEnd', 'range-end'],
  ['disabled', 'disabled'],
  ['today', 'today'],
  ['outside', 'outside'],
  ['hovered', 'hovered'],
  ['focused', 'focused'],
];

const dayClassNames = (state: DayState, custom?: string): string =>
  [
    'calendar-day',
    ...CLASS_FLAGS.filter(([flag]) => state[flag]).map(([, name]) => name),
    ...(custom ? [custom] : []),
  ].join(' ');

const isEndpoint = (day: DayRenderArgs): boolean =>
  day.selected || day.rangeStart || day.rangeEnd;

const backgroundFor = (day: DayRenderArgs): string => {
  if (isEndpoint(day)) return 'primary.main';
  if (day.inRange || day.hovered) return 'primary.light';
  return 'transparent';
};

const colorFor = (day: DayRenderArgs, visible: boolean): string => {
  if (isEndpoint(day)) return 'primary.contrastText';
  if (day.disabled) return 'text.disabled';
  // Outside days that are switched off still occupy the grid, they just have
  // nothing to show.
  if (!visible) return 'transparent';
  return 'text.primary';
};

const hoverBackgroundFor = (day: DayRenderArgs): string | undefined => {
  if (day.disabled) return undefined;
  return day.selected ? 'primary.dark' : 'action.hover';
};

const dayCellSx = (day: DayRenderArgs, visible: boolean): SxProps<Theme> => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: CELL_SIZE,
  height: CELL_SIZE,
  border: 'none',
  borderRadius: 1,
  cursor: day.disabled ? 'not-allowed' : 'pointer',
  backgroundColor: backgroundFor(day),
  color: colorFor(day, visible),
  opacity: !day.inCurrentMonth && visible ? 0.5 : 1,
  fontWeight: day.today ? 'bold' : 'normal',
  '&:hover': {
    backgroundColor: hoverBackgroundFor(day),
  },
  '&:focus': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 1,
  },
});

export interface CalendarDayProps {
  day: DayRenderArgs;
  focused: boolean;
  showOutsideDays: boolean;
  dayClassName?: (args: DayRenderArgs) => string;
  onSelect: (date: Date) => void;
  onHover: (date: Date) => void;
  onHoverEnd: () => void;
}

export const CalendarDay: FC<CalendarDayProps> = ({
  day,
  focused,
  showOutsideDays,
  dayClassName,
  onSelect,
  onHover,
  onHoverEnd,
}) => {
  const visible = day.inCurrentMonth || showOutsideDays;
  const state: DayState = { ...day, outside: !day.inCurrentMonth, focused };

  return (
    <Box
      component="button"
      role="gridcell"
      tabIndex={focused ? 0 : -1}
      aria-selected={day.selected}
      aria-disabled={day.disabled}
      aria-current={day.today ? 'date' : undefined}
      className={dayClassNames(state, dayClassName?.(day))}
      data-testid={`calendar-date-${day.date.getDate()}`}
      onClick={() => onSelect(day.date)}
      onMouseEnter={() => onHover(day.date)}
      onMouseLeave={onHoverEnd}
      sx={dayCellSx(day, visible)}
    >
      {day.selected && (
        <Box component="span" data-testid="calendar-selected-date" sx={{ display: 'none' }} />
      )}
      {day.today && (
        <Box component="span" data-testid="calendar-today" sx={{ display: 'none' }} />
      )}
      {visible ? day.date.getDate() : ''}
    </Box>
  );
};
