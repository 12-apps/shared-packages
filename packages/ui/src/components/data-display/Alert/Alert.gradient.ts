import type { Theme } from '@mui/material/styles/index.js';

import { absoluteInk } from '../../../tokens/ink';

import {
  deriveGradient,
  gradientBasis,
  gradientWorstContrast as worstContrast,
  holdsInEveryState as holds,
  sweepHolds as sweepHoldsCore,
  stepStopForInk as stepStop,
  type GradientBasis,
  type GradientLook,
  type GradientState,
} from './Alert.gradient.core';
import { GRADIENT_MODEL, type AlertPalette } from './Alert.metrics';

export {
  clearGradientCache,
  gradientDerivationCount,
  GRADIENT_POINTER_CONTRAST,
  GRADIENT_TARGET_CONTRAST,
  sweepPoints,
  type GradientBasis,
  type GradientLook,
} from './Alert.gradient.core';

/**
 * THE WEB GRADIENT'S SURFACE AND INK, DERIVED FROM THE HOST'S PALETTE (FUT-4516).
 *
 * The variant used to paint the hue's `light` and `dark` as they came, under
 * `getContrastText(main)`. No single ink holds 4.5:1 across a sweep that long:
 * white failed on the light end (2.41:1 on the default info) and a dark ink
 * failed on dark mode's dark end (4.26:1), before the 0.2 white shimmer lowered
 * either further.
 *
 * So the ink follows the MODE, as every other variant's does — the mode's dark
 * text in light mode, white in dark mode — and each end of the sweep is moved
 * only as far as that ink needs: toward white in light mode, toward black in
 * dark mode. Derived at style time from whatever `light` and `dark` the host's
 * theme supplies, so a host with its own hues gets its own passing sweep, and
 * no hex lives here. The arithmetic is `Alert.gradient.core.ts`, shared with
 * native.
 *
 * "As far as that ink needs" is judged across the states a reader meets: rest
 * (with a margin), and hovered and pressed, where in light mode the black tint
 * closes on the dark ink — an ink already near black has no room to step
 * further, so the SURFACE has to start lighter. In dark mode the tint is black,
 * away from the white ink, so the pointer states only help and rest decides.
 */

/** The basis for this theme: its paper and dark text, the palette's two absolutes. */
export function gradientBasisOf(theme: Theme): GradientBasis {
  const { white, black } = absoluteInk(theme);
  return gradientBasis(theme.palette.mode === 'dark' ? 'dark' : 'light', {
    paper: theme.palette.background.paper,
    textPrimary: theme.palette.text.primary,
    white,
    black,
  });
}

/** {@link worstContrast} with the web's numbers. */
export const gradientWorstContrast = (stop: string, basis: GradientBasis, state: GradientState): number =>
  worstContrast(stop, basis, GRADIENT_MODEL, state);

/** {@link holds} with the web's numbers. */
export const holdsInEveryState = (stop: string, basis: GradientBasis): boolean => holds(stop, basis, GRADIENT_MODEL);

/** {@link stepStop} with the web's numbers. */
export const stepStopForInk = (stop: string, basis: GradientBasis): string => stepStop(stop, basis, GRADIENT_MODEL);

/** Whether every point of the sweep between two ends holds the floor in every state. */
export const sweepHolds = (from: string, to: string, basis: GradientBasis): boolean =>
  sweepHoldsCore(from, to, basis, GRADIENT_MODEL);

/** The gradient's ink and both ends for this theme and hue. */
export function gradientLook(theme: Theme, palette: AlertPalette): GradientLook {
  return deriveGradient(gradientBasisOf(theme), GRADIENT_MODEL, palette.light || palette.main, palette.dark || palette.main);
}
