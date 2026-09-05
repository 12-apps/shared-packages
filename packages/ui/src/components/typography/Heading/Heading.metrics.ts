import type { HeadingWeight } from './Heading.base';
import { HEADING_SCALE, type HeadingLevel } from '../../../tokens/heading-scale';
import { FONT_WEIGHTS, type UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Heading` RENDERERS DRAW WITH.
 *
 * The type scale itself is `HEADING_SCALE` in `tokens/heading-scale.ts` (the
 * web reads it through the MUI theme's `headingScale` overrides, native
 * through `UiTheme.typography.heading`). What lives here is everything ELSE
 * `Heading.styles.ts` used to declare inline: the weight table, the defaults,
 * the rank each level announces, and the gradient's angle and stops.
 */
export const HEADING_WEIGHTS: Record<HeadingWeight, number> = FONT_WEIGHTS;

export const HEADING_DEFAULT_LEVEL: HeadingLevel = 'h2';
export const HEADING_DEFAULT_WEIGHT: HeadingWeight = 'bold';
export const HEADING_DEFAULT_COLOR: ColorValue = 'neutral';

export type HeadingRank = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The outline rank each level announces — the tag on the web, `aria-level` on
 * native. `display` is a SIZE, not a rank, so it is an h1: the document still
 * gets one level-one heading rather than an unnamed tag outside the outline.
 */
export const HEADING_RANK: Record<HeadingLevel, HeadingRank> = {
  display: 1,
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/** A step name the scale actually has, or the documented default (`h2`). */
export const stepOf = (value: string | undefined): HeadingLevel =>
  value !== undefined && value in HEADING_SCALE ? (value as HeadingLevel) : HEADING_DEFAULT_LEVEL;

const isHeadingWeight = (value: string): value is HeadingWeight => value in HEADING_WEIGHTS;

/**
 * The weight a heading draws: `normal` is the weight the step was designed to
 * carry (heavier as the step gets larger), anything else its table entry, and
 * a name outside the vocabulary the default — as `Heading.styles.ts` has
 * always fallen back.
 */
export function headingWeight(weight: string, normalWeight: number): number {
  if (weight === 'normal') return normalWeight;
  return HEADING_WEIGHTS[isHeadingWeight(weight) ? weight : HEADING_DEFAULT_WEIGHT];
}

/** The gradient runs corner to corner. */
export const HEADING_GRADIENT_ANGLE = 135;

/**
 * `neutral` has no light/dark pair, so its gradient runs between two steps of
 * the grey ramp.
 */
export const NEUTRAL_GRADIENT_STEPS = { from: 500, to: 900 } as const;

/** The CSS the web paints the glyphs with, from the two stops. */
export const headingGradient = (from: string, to: string): string =>
  `linear-gradient(${HEADING_GRADIENT_ANGLE}deg, ${from} 0%, ${to} 100%)`;

/**
 * The two stops each colour paints its glyphs with, read off a `UiTheme`. The
 * web's `Heading.styles.ts` keeps its MUI-typed twin of this table; the pairs
 * are the same, and `Heading.native.test.tsx` asserts as much.
 */
export function headingGradientStops(theme: UiTheme, color: ColorValue): [string, string] {
  switch (color) {
    case 'primary':
      return [theme.palette.primary.main, theme.palette.secondary.main];
    case 'secondary':
      return [theme.palette.secondary.main, theme.palette.primary.main];
    case 'neutral':
      return [theme.palette.grey[NEUTRAL_GRADIENT_STEPS.from], theme.palette.grey[NEUTRAL_GRADIENT_STEPS.to]];
    default:
      return [theme.palette[color].light, theme.palette[color].dark];
  }
}
