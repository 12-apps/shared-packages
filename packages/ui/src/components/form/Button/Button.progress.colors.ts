import { blend, darken, decomposeColor, getContrastRatio, getLuminance, lighten } from '../../../tokens/color';

/**
 * The two colours of a button drawn as a bar (`progress`): the TRACK (what is
 * still to go) and the FILL (what is done), both computed from the button's own
 * palette so a store's brand colour wins.
 *
 * The label sits on both, in the palette's `contrastText`, so BOTH must keep
 * WCAG AA text contrast (4.5:1) with it AS DRAWN (alpha-blended, `drawnInk`)
 * — for any palette, not just the default
 * one. A washed-out track (the button's colour at some alpha) cannot promise
 * that: `#1976d2` at 65 % over white gave 2.6:1. So the track is the button's
 * colour pushed AWAY from the ink until it reads, and the fill is the track
 * pushed further the same way, so the two stay apart and both stay readable.
 */
export const BUTTON_PROGRESS_MIN_CONTRAST = 4.5;

/** The least contrast between fill and track: the bar must show at a glance. */
export const BUTTON_PROGRESS_MIN_SEPARATION = 1.3;

/** How far the fill sits from the track: enough to see the bar at a glance. */
const FILL_SHIFT = 0.3;

const STEP = 0.05;

/**
 * The label as DRAWN on `surface`: `ink` at its own alpha, flattened over it.
 * MUI's dark `contrastText` is `rgba(0, 0, 0, 0.87)`; measuring the raw value
 * as if it were black over-states the contrast the eye actually gets.
 */
export function drawnInk(ink: string, surface: string): string {
  const { type, values } = decomposeColor(ink);
  const opacity = type === 'rgba' || type === 'hsla' ? (values[3] ?? 1) : 1;
  return blend(surface, ink, opacity);
}

/** How well the label, as drawn on `surface`, reads there. */
export function labelContrast(ink: string, surface: string): number {
  return getContrastRatio(drawnInk(ink, surface), surface);
}

/** `color` moved away from `ink` — darker under light ink, lighter under dark. */
function awayFromInk(color: string, ink: string, coefficient: number): string {
  return getLuminance(ink) > 0.5 ? darken(color, coefficient) : lighten(color, coefficient);
}

/** The nearest shade of `color`, away from `ink`, that keeps `minimum` contrast with it. */
export function withContrast(color: string, ink: string, minimum = BUTTON_PROGRESS_MIN_CONTRAST): string {
  for (let coefficient = 0; coefficient <= 1; coefficient += STEP) {
    const shade = awayFromInk(color, ink, coefficient);
    if (labelContrast(ink, shade) >= minimum) return shade;
  }
  return awayFromInk(color, ink, 1);
}

export interface ButtonProgressColors {
  track: string;
  fill: string;
}

/** `color` moved toward `ink` — lighter under light ink, darker under dark. */
function towardInk(color: string, ink: string, coefficient: number): string {
  return getLuminance(ink) > 0.5 ? lighten(color, coefficient) : darken(color, coefficient);
}

/**
 * The shade of `color` CLOSEST to `ink` that still keeps `minimum` contrast with
 * it — for a colour already at the far end (black under white ink), the only
 * room left to put a second shade in.
 */
function lastReadableTowardInk(color: string, ink: string, minimum = BUTTON_PROGRESS_MIN_CONTRAST): string {
  for (let coefficient = 1; coefficient > 0; coefficient -= STEP / 2) {
    const shade = towardInk(color, ink, coefficient);
    if (labelContrast(ink, shade) >= minimum) return shade;
  }
  return color;
}

/**
 * Track and fill. Normally the fill is the track pushed further from the ink.
 * A brand already at the far end (black, white, a pale yellow) has no room
 * there — the push lands on the same colour and the bar vanishes — so the
 * track moves TOWARD the ink instead, to the last shade that still reads, and
 * the far-end colour becomes the fill. Either way the label reads on both and
 * the two stay {@link BUTTON_PROGRESS_MIN_SEPARATION} apart.
 */
export function buttonProgressColors(main: string, ink: string): ButtonProgressColors {
  const readable = withContrast(main, ink);
  const pushed = awayFromInk(readable, ink, FILL_SHIFT);
  if (getContrastRatio(readable, pushed) >= BUTTON_PROGRESS_MIN_SEPARATION) {
    return { track: readable, fill: pushed };
  }
  return { track: lastReadableTowardInk(readable, ink), fill: readable };
}
