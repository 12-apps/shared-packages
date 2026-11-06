import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { getLuminance } from '../../../tokens/color';
import { absoluteInk } from '../../../tokens/ink';

import { ACTIVE, ALERT_EASING, type AlertPalette, POINTER_INK_STEP, seconds } from './Alert.metrics';

/**
 * THE INK HALF OF THE POINTER STATES (FUT-4506, option C).
 *
 * The hover and press tint (`pointerShadow` in `Alert.tsx`) moves the SURFACE
 * toward an absolute. On every surface but one that is the side the ink is on,
 * so the gap the title and summary are read across closed under the pointer —
 * a host summary at 4.71:1 idle fell to 3.17:1 pressed. These rules move the
 * INK further the same way, by {@link POINTER_INK_STEP}, so it re-opens.
 */

/** The summary's class, so the pointer states can reach it without a test id. */
export const ALERT_DESCRIPTION_CLASS = 'alert-description';

/** The two lines that step: the title and the summary. Never the icon, never a control. */
const MESSAGE_INK = `& .MuiAlertTitle-root, & .${ALERT_DESCRIPTION_CLASS}`;

export type PointerInkState = keyof typeof POINTER_INK_STEP;
export type InkAbsolute = 'black' | 'white';

/**
 * The absolute the ink steps toward: the one on the ink's OWN side.
 *
 * The mode answers it for every variant whose surface tracks the mode — a dark
 * ink on a light tint, a light ink on a dark one. `gradient` does not track it:
 * its ink is `getContrastText` of the hue, white in light mode and DARK on
 * dark mode's light `info`, `success` and `warning`. Read from that ink, the
 * step never moves a gradient's words toward its surface; a white ink stepping
 * toward white is a no-op, which is right, because the black layer already
 * widens that gap. The gradient's rest contrast and its shimmer are FUT-4516's.
 */
export function inkAbsolute(theme: Theme, colorPalette: AlertPalette, variant: string | undefined): InkAbsolute {
  if (variant === 'gradient') {
    return getLuminance(theme.palette.getContrastText(colorPalette.main)) > 0.5 ? 'white' : 'black';
  }
  return theme.palette.mode === 'dark' ? 'white' : 'black';
}

/**
 * The CSS for the ink at one pointer state: the ink actually painted
 * (`currentColor`, inherited from the root — a host's repaint included) mixed
 * toward the absolute by the state's step.
 *
 * `currentColor` in a `color` declaration is the PARENT's colour, which is why
 * this sits on the title and summary and never on the root: on the root it
 * would read the page's text colour instead of the alert's ink.
 */
export function steppedInkCss(absolute: string, step: number): string {
  return `color-mix(in srgb, currentColor ${Math.round((1 - step) * 100)}%, ${absolute})`;
}

/**
 * The three pieces of the ink's pointer behaviour, spread into the root's
 * blocks by `Alert.tsx`:
 *
 * - `rest` eases the ink on the box-shadow's own clock, so ink and tint arrive
 *   together rather than the ink snapping while the surface eases;
 * - `hover` and `press` step it. The press declares `transition: none` for the
 *   same reason the root's `:active` does: a click's `:active` is too short to
 *   ease into. A `:hover` block declares no transition, ever (see `ACTIVE`).
 */
export function pointerInkStyles(
  theme: Theme,
  colorPalette: AlertPalette,
  variant: string | undefined,
): Record<'rest' | PointerInkState, CSSObject> {
  const side = inkAbsolute(theme, colorPalette, variant);
  const absolute = absoluteInk(theme)[side];
  const at = (state: PointerInkState): string => steppedInkCss(absolute, POINTER_INK_STEP[state][side]);
  return {
    rest: { [MESSAGE_INK]: { transition: `color ${seconds(ACTIVE.ms)} ${ALERT_EASING}` } },
    hover: { [MESSAGE_INK]: { color: at('hover') } },
    press: { [MESSAGE_INK]: { color: at('press'), transition: 'none' } },
  };
}
