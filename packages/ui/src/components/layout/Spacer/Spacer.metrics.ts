import type { SpacerDirection, SpacerSize } from './Spacer.base';

/**
 * THE NUMBERS BOTH `Spacer` RENDERERS DRAW WITH.
 *
 * `Spacer.tsx` used to hold the size steps as a `switch` over
 * `theme.spacing(…)` calls, and `Spacer.native.tsx` would have held them again
 * as a second table. Now there is one, in SPACING UNITS, and each renderer
 * multiplies it out through its own `theme.spacing` — `'16px'` on the web,
 * `16` on native — so an `md` spacer is 16 wide on both sides by construction.
 */
export const SPACER_SIZE_UNITS: Record<SpacerSize, number> = {
  xs: 0.5,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
};

export const SPACER_DEFAULT_SIZE: SpacerSize = 'md';
export const SPACER_DEFAULT_DIRECTION: SpacerDirection = 'both';

/** `flex` grows the spacer by one share of the free space; every spacer refuses to shrink. */
export const SPACER_FLEX_GROW = 1;
export const SPACER_FLEX_SHRINK = 0;

/** The geometry props, with the dimension type left to the renderer. */
export interface SpacerGeometry<Dimension> {
  size?: SpacerSize;
  direction?: SpacerDirection;
  width?: Dimension;
  height?: Dimension;
}

/**
 * The width and height a spacer occupies, on either renderer.
 *
 * An explicit `width`/`height` wins on its axis whatever `direction` says; the
 * step fills only the axes `direction` names. `spacing` is the renderer's own
 * `theme.spacing`, so the same units come out as `'16px'` on the web and `16`
 * on native — the one resolver is what keeps the two from disagreeing.
 */
export function spacerDimensions<Dimension, Spacing>(
  geometry: SpacerGeometry<Dimension>,
  spacing: (units: number) => Spacing,
): { width: Dimension | Spacing | undefined; height: Dimension | Spacing | undefined } {
  const { size = SPACER_DEFAULT_SIZE, direction = SPACER_DEFAULT_DIRECTION, width, height } = geometry;
  // A size outside the vocabulary (a story control, an untyped caller) draws `md`,
  // exactly as the old `switch` did in its `default` arm.
  const step = spacing(SPACER_SIZE_UNITS[size] ?? SPACER_SIZE_UNITS[SPACER_DEFAULT_SIZE]);
  return {
    width: direction === 'vertical' ? width : (width ?? step),
    height: direction === 'horizontal' ? height : (height ?? step),
  };
}
