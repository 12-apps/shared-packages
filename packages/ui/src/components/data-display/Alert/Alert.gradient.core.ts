import { blend, darken, decomposeColor, getContrastRatio, lighten } from '../../../tokens/color';

/**
 * THE GRADIENT'S DERIVATION, RENDERER-FREE (FUT-4516).
 *
 * Pure arithmetic over plain colours and a {@link GradientModel}, so the web
 * (`Alert.gradient.ts`, a MUI theme) and native (`gradientSurface` in
 * `Alert.metrics.ts`, a `UiTheme`) derive the SAME ends and ink from the same
 * code. It imports no theme and no metrics: the numbers it judges with arrive
 * as the model, which keeps `Alert.metrics.ts` free to call it.
 *
 * What is judged, per end and across the sweep: the title (opacity 1) and the
 * description (its own opacity) over the stop painted at its alpha on the paper,
 * with and without the shimmer's white wash UNDER the words (the web paints the
 * words above the `::before`, see `gradientStyles`), at rest, hovered and
 * pressed. Rest keeps a margin over AA, and so does the pointer floor, because
 * the sweep's interior is not its ends.
 */

/** AA is 4.5:1; the extra tenth is the margin the 1% steps and the colour parser's rounding eat. */
export const GRADIENT_TARGET_CONTRAST = 4.6;
/** What hover and press must hold: AA with a small margin, since the interior of the sweep dips below its ends. */
export const GRADIENT_POINTER_CONTRAST = 4.55;
/** How many equal parts of the sweep are judged: t = 0, 0.05 … 1. */
const SWEEP_PARTS = 20;
/** How finely an end is mixed toward its absolute: 1% per try. */
const MIX_STEP = 0.01;

export type GradientState = 'rest' | 'hover' | 'press';

/** The numbers the derivation judges with; `Alert.metrics.ts` owns them (`GRADIENT_MODEL`). */
export interface GradientModel {
  stopAlpha: number;
  shimmerAlpha: number;
  descriptionOpacity: number;
  states: Record<'hover' | 'press', { tintAlpha: number; inkStep: { black: number; white: number } }>;
}

/** The colours the arithmetic composites with. */
export interface GradientBasis {
  paper: string;
  /** The shimmer's colour. */
  white: string;
  /** The ink, as the alert paints it at rest. */
  ink: string;
  /** The colour of the pointer tint the variant paints: black in both modes. */
  tint: string;
  /** The absolute the ink steps toward under the pointer, or `null` where it does not step (dark). */
  side: 'black' | 'white' | null;
  /** That absolute, as a colour; unused when `side` is `null`. */
  absolute: string;
  /** Which way the ends move: toward white in light mode, toward black in dark. */
  toward: 'white' | 'black';
}

const channelAlpha = (colour: string): number => decomposeColor(colour).values[3] ?? 1;

/**
 * The basis for a mode: the ink follows the mode (the theme's dark text in
 * light mode, white in dark), the tint is black in both (owner decision), and
 * the ink steps toward black only in light mode, where the tint closes on it.
 */
export function gradientBasis(
  mode: 'light' | 'dark',
  colours: { paper: string; textPrimary: string; white: string; black: string },
): GradientBasis {
  const dark = mode === 'dark';
  return {
    paper: colours.paper,
    white: colours.white,
    ink: dark ? colours.white : colours.textPrimary,
    tint: colours.black,
    absolute: colours.black,
    side: dark ? null : 'black',
    toward: dark ? 'black' : 'white',
  };
}

/**
 * The worst contrast over one painted surface colour `stop` (opaque; painted at
 * the model's alpha on the paper) in one state, with and without the shimmer.
 * The tint sits under the shimmer and moves the surface toward `tint`; the ink
 * steps toward `absolute` as `color-mix()` does, alpha too.
 */
export function gradientWorstContrast(stop: string, basis: GradientBasis, model: GradientModel, state: GradientState): number {
  const { tintAlpha, inkStep } = state === 'rest' ? { tintAlpha: 0, inkStep: { black: 0, white: 0 } } : model.states[state];
  const step = basis.side === null ? 0 : inkStep[basis.side];
  const tinted = blend(blend(basis.paper, stop, model.stopAlpha), basis.tint, tintAlpha);
  const surfaces = [tinted, blend(tinted, basis.white, model.shimmerAlpha)];
  const inkRgb = blend(basis.ink, basis.absolute, step);
  const inkAlpha = channelAlpha(basis.ink) * (1 - step) + step;
  const ratios = surfaces.flatMap((surface) =>
    [1, model.descriptionOpacity].map((opacity) => getContrastRatio(blend(surface, inkRgb, inkAlpha * opacity), surface)),
  );
  return Math.min(...ratios);
}

/** Whether `stop` holds in every state: the target at rest, the margin floor under the pointer. */
export function holdsInEveryState(stop: string, basis: GradientBasis, model: GradientModel): boolean {
  return (
    gradientWorstContrast(stop, basis, model, 'rest') >= GRADIENT_TARGET_CONTRAST &&
    (['hover', 'press'] as const).every((state) => gradientWorstContrast(stop, basis, model, state) >= GRADIENT_POINTER_CONTRAST)
  );
}

/**
 * `stop` moved toward the basis' absolute in 1% steps, as far as it takes to
 * hold in every state; a stop that already holds is returned as it was.
 */
export function stepStopForInk(stop: string, basis: GradientBasis, model: GradientModel): string {
  const mix = basis.toward === 'white' ? lighten : darken;
  const steps = Math.round(1 / MIX_STEP);
  const hit = Array.from({ length: steps + 1 }, (_, i) => mix(stop, i * MIX_STEP)).find((candidate) =>
    holdsInEveryState(candidate, basis, model),
  );
  return hit ?? mix(stop, 1);
}

/** The sweep's points as the browser interpolates two opaque stops in sRGB: t = 0, 0.05 … 1. */
export function sweepPoints(from: string, to: string): string[] {
  return Array.from({ length: SWEEP_PARTS + 1 }, (_, i) => blend(from, to, i / SWEEP_PARTS));
}

/** Whether every point of the sweep holds the pointer floor in every state. */
export function sweepHolds(from: string, to: string, basis: GradientBasis, model: GradientModel): boolean {
  return sweepPoints(from, to).every((point) =>
    (['rest', 'hover', 'press'] as const).every(
      (state) => gradientWorstContrast(point, basis, model, state) >= GRADIENT_POINTER_CONTRAST,
    ),
  );
}

export interface GradientLook {
  /** The ink of the title, the description and the icon. */
  ink: string;
  /** The sweep's two ends, opaque: the variant paints them at the model's stop alpha. */
  from: string;
  to: string;
}

/** How many derivations are kept; a host has a handful of palettes, so this is never reached in practice. */
const CACHE_LIMIT = 64;
const cache = new Map<string, GradientLook>();
let computed = 0;

/** How many derivations were computed rather than read from the cache (a test hook). */
export const gradientDerivationCount = (): number => computed;
/** Empty the cache (a test hook). */
export const clearGradientCache = (): void => cache.clear();

/** Everything the derivation reads, as one key: the two hue ends, the basis and the model's numbers. */
const keyOf = (basis: GradientBasis, model: GradientModel, light: string, dark: string): string =>
  [
    light, dark, basis.paper, basis.white, basis.ink, basis.tint, basis.absolute, basis.side, basis.toward,
    model.stopAlpha, model.shimmerAlpha, model.descriptionOpacity,
    model.states.hover.tintAlpha, model.states.hover.inkStep.black, model.states.hover.inkStep.white,
    model.states.press.tintAlpha, model.states.press.inkStep.black, model.states.press.inkStep.white,
  ].join('|');

/** Both ends moved on together, 1% at a time, until the interior of the sweep holds (at most 100 steps). */
function settle(ends: { from: string; to: string }, basis: GradientBasis, model: GradientModel): { from: string; to: string } {
  const mix = basis.toward === 'white' ? lighten : darken;
  const next = (acc: { from: string; to: string }, left: number): { from: string; to: string } =>
    left === 0 || sweepHolds(acc.from, acc.to, basis, model)
      ? acc
      : next({ from: mix(acc.from, MIX_STEP), to: mix(acc.to, MIX_STEP) }, left - 1);
  return next(ends, Math.round(1 / MIX_STEP));
}

/**
 * Both ends, each moved only as far as it needs, then both moved on together
 * while the INTERIOR of the sweep still dips under the floor (the middle of a
 * two-stop sRGB sweep is darker than the chord of its ends).
 *
 * Memoised on everything it reads: the styled callback runs on every render of
 * every gradient Alert, and the derivation is a few thousand contrast
 * evaluations, which the unit suite felt as a 3x slowdown of its alert files.
 */
export function deriveGradient(basis: GradientBasis, model: GradientModel, light: string, dark: string): GradientLook {
  const key = keyOf(basis, model, light, dark);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  computed += 1;
  const ends = { from: stepStopForInk(light, basis, model), to: stepStopForInk(dark, basis, model) };
  const look: GradientLook = { ink: basis.ink, ...settle(ends, basis, model) };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, look);
  return look;
}
