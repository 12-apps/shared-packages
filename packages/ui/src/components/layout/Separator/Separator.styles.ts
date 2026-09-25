import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type {
  SeparatorOrientation,
  SeparatorProps,
  SeparatorSize,
  SeparatorVariant,
} from './Separator.types';
import { FIELD_BORDER_WIDTH } from '../../../tokens/field-height.core';
import { rem } from '../../../tokens/relative';

const THICKNESS_PX: Record<SeparatorSize, number> = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
};

const MARGIN_PX: Record<SeparatorSize, number> = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

const separatorThickness = (size: SeparatorSize): number =>
  THICKNESS_PX[size] ?? THICKNESS_PX.md;

/** An explicit `margin` wins; otherwise the size picks one. */
export const separatorMargin = (
  size: SeparatorSize,
  margin?: number | string,
): number | string => margin ?? MARGIN_PX[size] ?? MARGIN_PX.md;

// `gradient` paints a background rather than a border, so it draws its line as a
// solid border of zero visual consequence.
const borderStyleFor = (variant: SeparatorVariant): 'dashed' | 'dotted' | 'solid' => {
  switch (variant) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    default:
      return 'solid';
  }
};

const gradientBackground = (
  variant: SeparatorVariant,
  orientation: SeparatorOrientation,
  color: string,
): string | undefined => {
  if (variant !== 'gradient') return undefined;
  const angle = orientation === 'horizontal' ? '90deg' : '180deg';
  return `linear-gradient(${angle}, transparent 0%, ${color} 50%, transparent 100%)`;
};

// Only the leading edge carries the rule; the other three are zeroed explicitly so
// a parent's border shorthand cannot leak through.
const borderEdges = (
  isHorizontal: boolean,
  thickness: string,
  style: 'dashed' | 'dotted' | 'solid',
  color: string,
): CSSObject => {
  const leading = isHorizontal ? 'Top' : 'Left';
  const blank: CSSObject = {
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopStyle: 'none',
    borderBottomStyle: 'none',
    borderLeftStyle: 'none',
    borderRightStyle: 'none',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  };

  return {
    ...blank,
    [`border${leading}Width`]: thickness,
    [`border${leading}Style`]: style,
    [`border${leading}Color`]: color,
  };
};

type SeparatorStyleArgs = Required<
  Pick<SeparatorProps, 'variant' | 'orientation' | 'size'>
> &
  Pick<SeparatorProps, 'color' | 'length'> & {
    /** From {@link separatorBlockMargin}, which both the plain and the labelled separator read. */
    blockMargin: string;
  };

/**
 * The separator's margin, on the axis it separates along only: above and below
 * a horizontal rule, either side of a vertical one. A margin given as a string
 * carries its own units; a number is design px, through the type scale.
 *
 * The LABELLED separator uses this too. It used to hand the number straight to
 * `sx.margin`, where a number is SPACING UNITS — `md`'s 16 drew 128px on all
 * four sides, against 16px above and below for the unlabelled one.
 */
export const separatorBlockMargin = (
  theme: Theme,
  size: SeparatorSize,
  margin: number | string | undefined,
  isHorizontal: boolean,
): string => {
  const value = separatorMargin(size, margin);
  const length = typeof value === 'string' ? value : rem(theme, value);
  return isHorizontal ? `${length} 0` : `0 ${length}`;
};

/**
 * The rule's extent along its axis. It lands in `sx`, which reads a number of 1
 * or less as a fraction of the parent, and that stays so; any other number is
 * design px, through the type scale. Unset (or `0`/`''`) is the full run.
 */
const ruleLength = (theme: Theme, length: SeparatorProps['length']): string => {
  if (!length) return '100%';
  if (typeof length === 'string') return length;
  return length <= 1 ? `${length * 100}%` : rem(theme, length);
};

/**
 * What a labelled separator's rules add to {@link separatorStyles}, and whether
 * the group stretches to its parent (FUT-2617).
 *
 * A labelled VERTICAL separator is a flex COLUMN — rule, label, rule — and with
 * no `length` each rule is `height: 100%` of a column whose height is its own
 * content: both resolved to 0px and only the label showed. So the column
 * stretches to the row it sits in and the two rules split what the label
 * leaves, equally (`flex: 1 1 0`), never shorter than a visible minimum. With a
 * `length` the rule is exactly that long: no grow, no shrink, no basis, and the
 * column keeps its content height, centred as before.
 *
 * Only the labelled branch reads this. The plain separator keeps
 * `separatorStyles` as is, since `flex: 1 1 0` there would widen a vertical
 * separator sitting in a row. The horizontal rules already shrink around the
 * label in their row, so they are left alone.
 */
export const labelledSeparatorLayout = (
  theme: Theme,
  isHorizontal: boolean,
  length: SeparatorProps['length'],
): { rule: CSSObject; group: CSSObject } => {
  if (isHorizontal) return { rule: {}, group: {} };
  if (length) return { rule: { flex: 'none' }, group: {} };
  return {
    // A design 16px, as long as the gap beside the label at the default
    // spacing, so a short or unsized row still shows two rules and not a word.
    rule: { flex: '1 1 0', minHeight: rem(theme, 16) },
    group: { alignSelf: 'stretch' },
  };
};

export const separatorStyles = (
  theme: Theme,
  { variant, orientation, size, color, blockMargin, length }: SeparatorStyleArgs,
): CSSObject => {
  const isHorizontal = orientation === 'horizontal';
  // `xs` is the 1px hairline: it stays one device-independent pixel at every
  // root size, like every other hairline in the package; heavier rules scale.
  const thicknessPx = separatorThickness(size);
  const thickness = thicknessPx === FIELD_BORDER_WIDTH ? `${FIELD_BORDER_WIDTH}px` : rem(theme, thicknessPx);
  const along = ruleLength(theme, length);
  const resolvedColor = color || theme.palette.divider;

  const baseStyles: CSSObject = {
    display: 'flex',
    alignItems: 'center',
    margin: blockMargin,
    width: isHorizontal ? along : thickness,
    height: isHorizontal ? thickness : along,
    boxSizing: 'border-box',
  };

  if (variant === 'gradient') {
    return {
      ...baseStyles,
      background: gradientBackground(variant, orientation, resolvedColor),
    };
  }

  return {
    ...baseStyles,
    backgroundColor: 'transparent',
    ...borderEdges(isHorizontal, thickness, borderStyleFor(variant), resolvedColor),
  };
};
