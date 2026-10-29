import type { SxProps, Theme } from '@mui/material/styles/index.js';
import Box from '@mui/material/Box/index.js';
import type { FC } from 'react';
import React from 'react';

import { rem, sxRem } from '../../../tokens/relative';

import type { DayBand } from './Calendar.band';
import { bandColor, endpointFill, endpointHoverFill } from './Calendar.band';
import type { DayRenderArgs } from './Calendar.types';

/**
 * A column's width: the 304 design px a month asked for when its seven 40px
 * cells sat 4px apart, shared by seven columns that now touch (FUT-4162). The
 * cell fills its column up to this size, so the month shrinks with its
 * container instead of holding a fixed 304px floor (FUT-3861).
 */
const COLUMN_SIZE = sxRem(304 / 7);

/** 304/7 wide to 40 tall: the day's face is a 40 design px circle at full size. */
const CELL_RATIO = '38 / 35';

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

// The band's share of the cell (see `Calendar.band.ts`): all of it, or the
// half that faces the rest of the range.
const BAND_IMAGE: Record<Exclude<DayBand, 'none'>, (band: string) => string> = {
  full: (band) => `linear-gradient(${band}, ${band})`,
  after: (band) => `linear-gradient(to right, transparent 50%, ${band} 50%)`,
  before: (band) => `linear-gradient(to left, transparent 50%, ${band} 50%)`,
};

// A gradient's `to right` is physical; a right-to-left grid starts a range on
// its right, so the two halves trade places there.
const inDirection = (band: Exclude<DayBand, 'none'>, theme: Theme): Exclude<DayBand, 'none'> => {
  if (theme.direction !== 'rtl' || band === 'full') return band;
  return band === 'after' ? 'before' : 'after';
};

const faceBackgroundFor = (day: DayRenderArgs): ((theme: Theme) => string) | string =>
  isEndpoint(day) ? endpointFill : 'transparent';

const colorFor = (day: DayRenderArgs, visible: boolean): string => {
  if (isEndpoint(day)) return 'primary.contrastText';
  if (day.disabled) return 'text.disabled';
  // Outside days that are switched off still occupy the grid, they just have
  // nothing to show.
  if (!visible) return 'transparent';
  return 'text.primary';
};

const hoverBackgroundFor = (day: DayRenderArgs): ((theme: Theme) => string) | string | undefined => {
  if (day.disabled) return undefined;
  return isEndpoint(day) ? endpointHoverFill : 'action.hover';
};

// The band reaches the cell's edges so neighbouring days join; where a week
// row ends, it rounds off instead of stopping square: half the cell each way
// is a half-round cap on a cell as tall as it is wide.
const BAND_RADIUS = '50%';

/**
 * One cell: the band, painted on the button across its whole column, and the
 * day's round face, a `::before` circle behind the number. The face is a
 * pseudo-element so the button's own content stays the bare day number a host's
 * tests query (`getByText('27')` is the cell, as it always was).
 */
const dayCellSx = (day: DayRenderArgs, band: DayBand, visible: boolean): SxProps<Theme> => ({
  position: 'relative',
  isolation: 'isolate',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // The column it ASKS for keeps the month's intrinsic width at 304 (FUT-3861),
  // now that the seven columns carry no gap between them; `maxWidth` and the
  // column's `minmax(0, 1fr)` let it give way below that, and the ratio keeps
  // it 40 tall at full size and shrinking with it.
  width: COLUMN_SIZE,
  maxWidth: '100%',
  aspectRatio: CELL_RATIO,
  justifySelf: 'stretch',
  boxSizing: 'border-box',
  padding: 0,
  border: 'none',
  background: 'none',
  backgroundImage: band === 'none' ? 'none' : (theme: Theme) => BAND_IMAGE[inDirection(band, theme)](bandColor(theme)),
  cursor: day.disabled ? 'not-allowed' : 'pointer',
  color: colorFor(day, visible),
  opacity: !day.inCurrentMonth && visible ? 0.5 : 1,
  fontWeight: day.today || isEndpoint(day) ? 'bold' : 'normal',
  '&:nth-of-type(7n + 1)': { borderStartStartRadius: BAND_RADIUS, borderEndStartRadius: BAND_RADIUS },
  '&:nth-of-type(7n)': { borderStartEndRadius: BAND_RADIUS, borderEndEndRadius: BAND_RADIUS },
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    margin: 'auto',
    zIndex: -1,
    // A circle as tall as the cell: 40 design px at full size (FUT-3861).
    height: '100%',
    aspectRatio: '1 / 1',
    maxWidth: '100%',
    borderRadius: '50%',
    backgroundColor: faceBackgroundFor(day),
  },
  '&:hover::before': {
    backgroundColor: hoverBackgroundFor(day),
  },
  '&:focus': { outline: 'none' },
  '&:focus::before': {
    outline: (theme: Theme) => `${rem(theme, 2)} solid`,
    outlineColor: 'primary.main',
    outlineOffset: sxRem(1),
  },
});

export interface CalendarDayProps {
  day: DayRenderArgs;
  band: DayBand;
  focused: boolean;
  showOutsideDays: boolean;
  dayClassName?: (args: DayRenderArgs) => string;
  onSelect: (date: Date) => void;
  onHover: (date: Date) => void;
  onHoverEnd: () => void;
}

export const CalendarDay: FC<CalendarDayProps> = ({
  day,
  band,
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
      sx={dayCellSx(day, band, visible)}
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
