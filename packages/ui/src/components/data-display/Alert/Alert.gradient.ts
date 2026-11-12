import type { Theme } from '@mui/material/styles/index.js';

import { absoluteInk } from '../../../tokens/ink';
import { blend, darken, decomposeColor, getContrastRatio, lighten } from '../../../tokens/color';

import { DESCRIPTION, GRADIENT, POINTER_STATES, type AlertPalette } from './Alert.metrics';

/**
 * THE GRADIENT'S SURFACE AND INK, DERIVED FROM THE HOST'S PALETTE (FUT-4516).
 *
 * The variant used to paint the hue's `light` and `dark` as they came, under
 * `getContrastText(main)`. No single ink holds 4.5:1 across a sweep that long:
 * white failed on the light end (2.41:1 on the default info) and a dark ink
 * failed on dark mode's dark end (4.26:1), before the 0.2 white shimmer lowered
 * either further.
 *
 * So the ink follows the MODE, as every other variant's does — the mode's dark
 * text in light mode, white in dark mode — and each end of the sweep is moved
 * only as far as that ink needs: toward white in light mode (the hue stays
 * vivid at the end that was already fine), toward black in dark mode. Derived
 * at style time from whatever `light` and `dark` the host's theme supplies, so
 * a host with its own hues gets its own passing sweep, and no hex lives here.
 */

/** AA is 4.5:1; the extra tenth is the margin the 1% steps and the colour parser's rounding eat. */
export const GRADIENT_TARGET_CONTRAST = 4.6;
/**
 * What a pointer state must still hold: the AA floor itself. Rest keeps the
 * margin above; hover and press are measured against the floor, because the
 * ink's own step (`POINTER_INK_STEP`) is already in the arithmetic.
 */
export const GRADIENT_POINTER_CONTRAST = 4.5;

/** How finely the mix is stepped: 1% of the way to the absolute per try. */
const MIX_STEP = 0.01;

const channelAlpha = (colour: string): number => decomposeColor(colour).values[3] ?? 1;

/** The theme-derived colours the arithmetic composites with. */
export interface GradientBasis {
  paper: string;
  /** The shimmer's colour. */
  white: string;
  /** The ink, as the alert paints it at rest. */
  ink: string;
  /** The absolute the pointer tint and the ink's step move toward: the mode's. */
  absolute: string;
  side: 'black' | 'white';
}

/**
 * The worst contrast the title (opacity 1) and the description
 * ({@link DESCRIPTION} opacity) reach over `stop` painted at the gradient's
 * alpha on the paper, with and without the shimmer's white wash on top, in one
 * pointer state. The tint layer sits under the shimmer and moves the surface
 * toward `absolute`; the ink steps toward it as `color-mix()` does, alpha too.
 */
export function gradientWorstContrast(stop: string, basis: GradientBasis, state: keyof typeof POINTER_STATES | 'rest'): number {
  const { tintAlpha, inkStep } = state === 'rest' ? { tintAlpha: 0, inkStep: { black: 0, white: 0 } } : POINTER_STATES[state];
  const step = inkStep[basis.side];
  const tinted = blend(blend(basis.paper, stop, GRADIENT.stopAlpha), basis.absolute, tintAlpha);
  const surfaces = [tinted, blend(tinted, basis.white, GRADIENT.shimmerAlpha)];
  const inkRgb = blend(basis.ink, basis.absolute, step);
  const inkAlpha = channelAlpha(basis.ink) * (1 - step) + step;
  const ratios = surfaces.flatMap((surface) =>
    [1, DESCRIPTION.opacity].map((opacity) => getContrastRatio(blend(surface, inkRgb, inkAlpha * opacity), surface)),
  );
  return Math.min(...ratios);
}

/** Whether `stop` holds in every state: the target at rest, the floor under the pointer. */
export function holdsInEveryState(stop: string, basis: GradientBasis): boolean {
  return (
    gradientWorstContrast(stop, basis, 'rest') >= GRADIENT_TARGET_CONTRAST &&
    (['hover', 'press'] as const).every((state) => gradientWorstContrast(stop, basis, state) >= GRADIENT_POINTER_CONTRAST)
  );
}

/**
 * `stop` moved toward `toward` ('white' lightens, 'black' darkens) in 1% steps,
 * as far as it takes for the ink to hold at rest, hovered and pressed; a stop
 * that already holds is returned as it was.
 */
export function stepStopForInk(stop: string, toward: 'white' | 'black', basis: GradientBasis): string {
  const mix = toward === 'white' ? lighten : darken;
  const steps = Math.round(1 / MIX_STEP);
  const hit = Array.from({ length: steps + 1 }, (_, i) => mix(stop, i * MIX_STEP)).find((candidate) =>
    holdsInEveryState(candidate, basis),
  );
  return hit ?? mix(stop, 1);
}

export interface GradientLook {
  /** The ink of the title, the description and the icon. */
  ink: string;
  /** The sweep's two ends, opaque: the variant paints them at `GRADIENT.stopAlpha`. */
  from: string;
  to: string;
}

/** The gradient's ink and both ends for this theme and hue. */
export function gradientLook(theme: Theme, palette: AlertPalette): GradientLook {
  const dark = theme.palette.mode === 'dark';
  const { white, black } = absoluteInk(theme);
  const ink = dark ? white : theme.palette.text.primary;
  const basis: GradientBasis = {
    paper: theme.palette.background.paper,
    white,
    ink,
    absolute: dark ? white : black,
    side: dark ? 'white' : 'black',
  };
  const toward = dark ? 'black' : 'white';
  return {
    ink,
    from: stepStopForInk(palette.light || palette.main, toward, basis),
    to: stepStopForInk(palette.dark || palette.main, toward, basis),
  };
}
