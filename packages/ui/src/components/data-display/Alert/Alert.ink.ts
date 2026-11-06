import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { absoluteInk } from '../../../tokens/ink';

import { ACTIVE, ALERT_EASING, POINTER_INK_STEP, seconds } from './Alert.metrics';

/**
 * THE INK HALF OF THE POINTER STATES (FUT-4506, option C).
 *
 * The hover and press tint (`pointerShadow` in `Alert.tsx`) moves the SURFACE
 * toward an absolute. On every surface that tracks the mode that is the side
 * the ink is on, so the gap the message is read across closed under the
 * pointer — a host summary at 4.71:1 idle fell to 3.17:1 pressed. These rules
 * move the INK further the same way, by {@link POINTER_INK_STEP}, so it
 * re-opens.
 */

/** The summary's class, so the pointer states can reach it without a test id. */
export const ALERT_DESCRIPTION_CLASS = 'alert-description';
/**
 * The wrapper `AlertContent` puts around `children`, at `display: contents`:
 * no box of its own, so the column's flex layout is what it was, and a bare
 * text node still inherits its colour.
 */
export const ALERT_CHILDREN_CLASS = 'alert-children';

/**
 * What steps: the WORDS of the message — the title, the description and
 * whatever the caller passed as `children` — each one step, none nested in
 * another. Stepping only the title and the description left a children-only
 * alert (about one in six in the first host measured) at its rest ink under
 * the press tint.
 *
 * Not the whole message column, because the column is not only words: with
 * `iconPlacement: 'title'` the icon sits in it, on the title's row, beside
 * `.MuiAlertTitle-root` rather than inside it. The icon is the variant's
 * meaning, not an affordance, so it stays still in both placements; the close
 * button (`.MuiAlert-action`) is outside the column altogether. A control
 * inside `children` keeps its own colour, because it declares one; only a
 * `color="inherit"` one follows the step, on the same tinted surface as the
 * words around it.
 */
const MESSAGE_INK = `& .MuiAlertTitle-root, & .${ALERT_DESCRIPTION_CLASS}, & .${ALERT_CHILDREN_CLASS}`;

export type PointerInkState = keyof typeof POINTER_INK_STEP;
export type InkAbsolute = 'black' | 'white';

/**
 * The absolute the ink steps toward — the mode's, the side the ink is on — or
 * `null` for `gradient`, which does not step at all.
 *
 * Every other variant's surface tracks the mode: a dark ink on a light tint,
 * a light ink on a dark one, so the step is toward black in light mode and
 * toward white in dark, the same absolute the tint layer moves the surface to.
 *
 * `gradient` is the one surface where the package cannot know which side its
 * ink is on. Its own ink is `getContrastText` of the hue, but a host that
 * repaints alerts repaints the gradient too: a light pane and a dark ink under
 * the variant's BLACK layer. Stepping by the package's own ink then moved that
 * dark ink toward white — 1.02:1 pressed. A step that reads `currentColor` for
 * its amount but not for its direction is only safe where the direction is the
 * mode's, so `gradient` keeps today's ink. Its rest contrast and its dark ink
 * on dark mode's light hues are FUT-4516's.
 */
export function inkAbsolute(theme: Theme, variant: string | undefined): InkAbsolute | null {
  if (variant === 'gradient') return null;
  return theme.palette.mode === 'dark' ? 'white' : 'black';
}

/**
 * The CSS for the ink at one pointer state: the ink actually painted
 * (`currentColor`, inherited from the root — a host's repaint included) mixed
 * toward the absolute by the state's step.
 *
 * `currentColor` in a `color` declaration is the PARENT's colour, which is why
 * this sits on the message's parts and never on the root: on the root it would
 * read the page's text colour instead of the alert's ink. None of the three
 * parts is nested in another, so nothing steps twice.
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
 *
 * All three are empty for a variant that does not step.
 */
export function pointerInkStyles(theme: Theme, variant: string | undefined): Record<'rest' | PointerInkState, CSSObject> {
  const side = inkAbsolute(theme, variant);
  if (side === null) return { rest: {}, hover: {}, press: {} };
  const absolute = absoluteInk(theme)[side];
  const at = (state: PointerInkState): string => steppedInkCss(absolute, POINTER_INK_STEP[state][side]);
  return {
    rest: { [MESSAGE_INK]: { transition: `color ${seconds(ACTIVE.ms)} ${ALERT_EASING}` } },
    hover: { [MESSAGE_INK]: { color: at('hover') } },
    press: { [MESSAGE_INK]: { color: at('press'), transition: 'none' } },
  };
}
