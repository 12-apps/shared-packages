/**
 * The surface of the reader's OWN bubbles: the theme's primary colour, washed
 * out to a tint the body text still reads on. Derived from the theme on every
 * render, so a host's brand colour (and its dark mode) reaches the thread with
 * nothing to configure.
 *
 * The others' bubbles keep the paper surface. Both surfaces used to be a
 * surface token, and the two tokens resolve to the same colour in most themes,
 * so which side wrote a line was told only by the label's colour.
 */

import { alpha, type UiTheme } from "@12-apps/ui/tokens";

/** How much of the primary colour shows through: light text on dark needs more to be seen. */
const OWN_TINT_STRENGTH = { light: 0.08, dark: 0.16 } as const;

export function ownBubbleTint(theme: UiTheme): string {
  return alpha(theme.palette.primary.main, OWN_TINT_STRENGTH[theme.mode]);
}
