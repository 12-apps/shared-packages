import { darken, getContrastRatio, getLuminance, lighten } from '../../../tokens/color';

/**
 * The two colours of a button drawn as a bar (`progress`): the TRACK (what is
 * still to go) and the FILL (what is done), both computed from the button's own
 * palette so a store's brand colour wins.
 *
 * The label sits on both, in the palette's `contrastText`, so BOTH must keep
 * WCAG AA text contrast (4.5:1) with it — for any palette, not just the default
 * one. A washed-out track (the button's colour at some alpha) cannot promise
 * that: `#1976d2` at 65 % over white gave 2.6:1. So the track is the button's
 * colour pushed AWAY from the ink until it reads, and the fill is the track
 * pushed further the same way, so the two stay apart and both stay readable.
 */
export const BUTTON_PROGRESS_MIN_CONTRAST = 4.5;

/** How far the fill sits from the track: enough to see the bar at a glance. */
const FILL_SHIFT = 0.3;

const STEP = 0.05;

/** `color` moved away from `ink` — darker under light ink, lighter under dark. */
function awayFromInk(color: string, ink: string, coefficient: number): string {
  return getLuminance(ink) > 0.5 ? darken(color, coefficient) : lighten(color, coefficient);
}

/** The nearest shade of `color`, away from `ink`, that keeps `minimum` contrast with it. */
export function withContrast(color: string, ink: string, minimum = BUTTON_PROGRESS_MIN_CONTRAST): string {
  for (let coefficient = 0; coefficient <= 1; coefficient += STEP) {
    const shade = awayFromInk(color, ink, coefficient);
    if (getContrastRatio(ink, shade) >= minimum) return shade;
  }
  return awayFromInk(color, ink, 1);
}

export interface ButtonProgressColors {
  track: string;
  fill: string;
}

export function buttonProgressColors(main: string, ink: string): ButtonProgressColors {
  const track = withContrast(main, ink);
  return { track, fill: awayFromInk(track, ink, FILL_SHIFT) };
}
