import type { CSSObject, Theme } from '@mui/material';

import type { SettingsNavStatus, SettingsRailBreakpoint } from './SettingsLayout.types';

/** Fixed width of the left navigation rail once it has its own column. */
export const RAIL_WIDTH = 300;

/** Visually hidden, still read aloud — for text a marker's colour cannot carry. */
export const SR_ONLY_SX: CSSObject = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * The media query for "the rail has its own column".
 *
 * `theme.breakpoints.up` takes a NUMBER as happily as a name, which is why
 * `railBreakpoint` accepts one: a settings area whose structural switch is at
 * 1024px has no MUI breakpoint to name (the default `lg` is 1200), and rounding
 * the design to the nearest named breakpoint moves 176px of behaviour to keep a
 * string tidy.
 */
export function atLeastRail(theme: Theme, breakpoint: SettingsRailBreakpoint): string {
  return theme.breakpoints.up(breakpoint);
}

/**
 * A `display` pair across that query: `narrow` below it, `wide` at and above.
 *
 * Everything that changes shape between the two navigation modes goes through
 * this, so "which width am I?" is answered once, in CSS, for every part at
 * once — rather than by each part asking a media query in JavaScript and
 * answering slightly differently.
 */
export function displayAcrossRail(
  theme: Theme,
  breakpoint: SettingsRailBreakpoint,
  narrow: string,
  wide: string,
): CSSObject {
  return { display: narrow, [atLeastRail(theme, breakpoint)]: { display: wide } };
}

/** Minimum touch target, in px. Held down to 320px-wide phones, deliberately. */
export const TOUCH_TARGET = 44;

/**
 * Palette role per situation.
 *
 * Returned as theme keys rather than hex so a marker follows the host's theme —
 * and so light and dark do not need two copies of this table.
 */
export const STATUS_COLOR: Record<Exclude<SettingsNavStatus, 'locked'>, string> = {
  ok: 'success.main',
  off: 'text.disabled',
  new: 'error.main',
};
