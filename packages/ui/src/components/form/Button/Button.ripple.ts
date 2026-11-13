import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { getLuminance } from '../../../tokens/color';
import { absoluteInk } from '../../../tokens/ink';

/**
 * THE PRESS RIPPLE IS PAINTED ON THE SIDE THAT NEVER LOWERS THE LABEL (FUT-4861).
 *
 * MUI paints a ripple in `currentColor`, the label's own colour, at about 30%.
 * Under the label (see `rippleUnderLabelStyles`) it no longer veils the glyph,
 * but it still moves the SURFACE toward the ink, and that is what dropped a held
 * button's label under 4.5:1. So the press ripple is painted in the absolute on
 * the SURFACE's side of the ink: white where the surface is lighter than the
 * label (a dark label on paper, a mid hue on paper), black where it is darker (a
 * light label on a hue). It moves the surface away from the ink, never toward it.
 *
 * Both sides are read from what the variant paints, never from the mode: a dark
 * label on a light surface and a light label on a hue differ inside one mode.
 * Choosing by the ink alone is wrong for a mid-tone ink on a light surface, where
 * the darker absolute is the one that closes on it. Opacity and timing are MUI's.
 * The focus pulsate (`.MuiTouchRipple-ripplePulsate`) is an outline or text
 * button's only keyboard focus indicator, so it keeps `currentColor`.
 */
export const oppositeAbsolute = (theme: Theme, ink: string, surface: string): string => {
  const { black, white } = absoluteInk(theme);
  return getLuminance(surface) >= getLuminance(ink) ? white : black;
};

export const pressRippleStyles = (theme: Theme, ink: string | undefined, surface: string): CSSObject =>
  ink === undefined
    ? {}
    : {
        '& .MuiTouchRipple-ripple:not(.MuiTouchRipple-ripplePulsate)': {
          color: oppositeAbsolute(theme, ink, surface),
        },
      };
