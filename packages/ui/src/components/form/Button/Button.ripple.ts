import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { getLuminance } from '../../../tokens/color';
import { absoluteInk } from '../../../tokens/ink';

/**
 * THE PRESS RIPPLE OF A FILLED BUTTON IS PAINTED ON THE SIDE THAT NEVER LOWERS THE LABEL (FUT-4861).
 *
 * MUI paints a ripple in `currentColor`, the label's own colour, at about 30%.
 * Under the label (see `contentAboveRippleStyles`) it no longer veils the glyph,
 * but on a button that paints its own FILL (`solid`, `gradient`) it still moves
 * that fill toward the ink, and that is what dropped a held contained button's
 * label under 4.5:1. So its press ripple is painted in the absolute on the fill's
 * side of the ink: white where the fill is lighter than the label, black where it
 * is darker. It moves the fill away from the ink, never toward it.
 *
 * Only a variant with a fill of its own is tinted. `outline`, `text`, `ghost` and
 * `glass` sit on whatever the host paints, which the button cannot read; an
 * assumed paper colour painted the page's own colour and made the press
 * invisible, so they keep MUI's `currentColor` ripple exactly as before.
 * Opacity and timing are MUI's. The focus pulsate
 * (`.MuiTouchRipple-ripplePulsate`) keeps `currentColor` on every variant.
 */
const FILLED_VARIANTS = new Set(['solid', 'gradient']);

export const oppositeAbsolute = (theme: Theme, ink: string, fill: string): string => {
  const { black, white } = absoluteInk(theme);
  return getLuminance(fill) >= getLuminance(ink) ? white : black;
};

export const pressRippleStyles = (
  theme: Theme,
  variant: string | undefined,
  ink: string | undefined,
  fill: string,
): CSSObject =>
  ink === undefined || !FILLED_VARIANTS.has(variant ?? '')
    ? {}
    : {
        '& .MuiTouchRipple-ripple:not(.MuiTouchRipple-ripplePulsate)': {
          color: oppositeAbsolute(theme, ink, fill),
        },
      };
