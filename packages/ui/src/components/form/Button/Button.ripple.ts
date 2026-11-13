import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { getContrastRatio } from '../../../tokens/color';
import { absoluteInk } from '../../../tokens/ink';

/**
 * THE PRESS RIPPLE IS PAINTED ON THE SIDE THAT NEVER LOWERS THE LABEL (FUT-4861).
 *
 * MUI paints a ripple in `currentColor`, the label's own colour, at about 30%.
 * Under the label (see `rippleUnderLabelStyles`) it no longer veils the glyph,
 * but it still moves the SURFACE toward the ink, and that is what dropped a held
 * button's label under 4.5:1. So the press ripple is painted in the absolute
 * OPPOSITE the ink actually painted: black under a light label, white under a
 * dark one. It moves the surface away from the ink, and never against it.
 *
 * The side is read from the label's own colour, never from the mode: a dark
 * label on a light surface and a light label on a hue differ inside one mode.
 * Opacity and timing are MUI's. The focus pulsate
 * (`.MuiTouchRipple-ripplePulsate`) is a text or outline button's only keyboard
 * focus indicator, so it keeps `currentColor`: only the press ripple is repainted.
 */
export const oppositeAbsolute = (theme: Theme, ink: string): string => {
  const { black, white } = absoluteInk(theme);
  return getContrastRatio(ink, black) >= getContrastRatio(ink, white) ? black : white;
};

export const pressRippleStyles = (theme: Theme, ink: string | undefined): CSSObject =>
  ink === undefined
    ? {}
    : {
        '& .MuiTouchRipple-ripple:not(.MuiTouchRipple-ripplePulsate)': { color: oppositeAbsolute(theme, ink) },
      };
