import type { Theme } from '@mui/material/styles/index.js';

import { alpha, blend, darken, decomposeColor, getContrastRatio, getLuminance, lighten } from '../../../tokens/color';

import { isSameDay } from './Calendar.dates';
import type { DateRange, DayRenderArgs, SelectionMode } from './Calendar.types';

/**
 * WHERE A DAY SITS ON THE RANGE BAND (FUT-4162).
 *
 * A selected range is ONE band behind its days, not a tile per day: the grid
 * has no column gap and each day paints its share of the band. A day strictly
 * inside the range paints all of it (`full`); the first and last day paint the
 * half that faces the rest of the range (`after` / `before`), so the band runs
 * into the round endpoint and stops at its centre. A range of one day, or no
 * range, paints none.
 *
 * While only the start is chosen, the hovered day stands in for the end, the
 * same preview `isDateInRange` draws.
 */
export type DayBand = 'none' | 'full' | 'after' | 'before';

// The other end of the range: its end, or while only the start is chosen, the
// hovered day standing in for it.
const otherEnd = (range: DateRange, hoveredDate: Date | null, isDisabled: (date: Date) => boolean) =>
  range.end ?? (hoveredDate && !isDisabled(hoveredDate) ? hoveredDate : null);

// The half an endpoint paints: towards the rest of the range.
const endpointBand = (date: Date, start: Date, other: Date): DayBand => {
  const [first, last] = start < other ? [start, other] : [other, start];
  if (isSameDay(date, first)) return 'after';
  if (isSameDay(date, last)) return 'before';
  return 'none';
};

export const bandFor = ({
  args,
  selectionMode,
  range,
  hoveredDate,
  isDisabled,
}: {
  args: DayRenderArgs;
  selectionMode: SelectionMode;
  range: DateRange;
  hoveredDate: Date | null;
  isDisabled: (date: Date) => boolean;
}): DayBand => {
  if (selectionMode !== 'range') return 'none';
  if (args.inRange) return 'full';

  const other = otherEnd(range, hoveredDate, isDisabled);
  if (!range.start || !other || isSameDay(range.start, other)) return 'none';
  return endpointBand(args.date, range.start, other);
};

/**
 * The band: the brand at a quarter strength, so it reads as the brand's tint on
 * any ground (on white it is the brand three quarters of the way to white).
 */
export const BAND_OPACITY = 0.25;

export const bandColor = (theme: Theme): string => alpha(theme.palette.primary.main, BAND_OPACITY);

/**
 * WCAG AA for body text, plus a margin: `getLuminance` rounds to three
 * places, which can move a ratio by about a hundredth either way.
 */
const ENDPOINT_MIN_CONTRAST = 4.55;
const STEP = 0.01;

// The ink as it reads ON the fill: MUI's dark ink is 87% black, so it is laid
// over the fill before it is measured, rather than taken as solid black.
const readsAt = (ink: string, fill: string): number => {
  const [, , , opacity = 1] = decomposeColor(ink).values;
  return getContrastRatio(opacity < 1 ? blend(fill, ink, opacity) : ink, fill);
};

// Light ink (white) wants a darker fill; dark ink a lighter one.
const awayFromInk = (ink: string): ((color: string, coefficient: number) => string) =>
  getLuminance(ink) > 0.5 ? darken : lighten;

/**
 * An endpoint's fill: the brand, moved away from its own ink JUST far enough
 * for that ink to read at AA (FUT-4162).
 *
 * The ink is the palette's `primary.contrastText`, which MUI picks at 3:1, so
 * a brand can ship an ink that reads at 3 to 4.5:1 on it — the default indigo
 * is 4.47:1 under white. Rather than change the ink (every other component
 * shares it), the fill gives way: darker under white ink, lighter under dark
 * ink. A brand that already passes is returned unchanged; the default indigo
 * moves by one percent, which no one can see.
 */
export const endpointFill = (theme: Theme): string => {
  const { main, contrastText } = theme.palette.primary;
  try {
    if (readsAt(contrastText, main) >= ENDPOINT_MIN_CONTRAST) return main;
    const move = awayFromInk(contrastText);
    for (let coefficient = STEP; coefficient < 1; coefficient += STEP) {
      const fill = move(main, coefficient);
      if (readsAt(contrastText, fill) >= ENDPOINT_MIN_CONTRAST) return fill;
    }
    return move(main, 1);
  } catch {
    // A colour format the helpers cannot decompose: the brand as it is.
    return main;
  }
};

/** A hovered endpoint: one more step the same way, so it only gains contrast. */
export const endpointHoverFill = (theme: Theme): string => {
  const fill = endpointFill(theme);
  try {
    return awayFromInk(theme.palette.primary.contrastText)(fill, 0.15);
  } catch {
    return fill;
  }
};
