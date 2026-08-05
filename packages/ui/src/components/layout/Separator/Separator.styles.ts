import type { CSSObject, Theme } from '@mui/material';

import type {
  SeparatorOrientation,
  SeparatorProps,
  SeparatorSize,
  SeparatorVariant,
} from './Separator.types';

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
  thickness: number,
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
  Pick<SeparatorProps, 'color' | 'margin' | 'length'>;

export const separatorStyles = (
  theme: Theme,
  { variant, orientation, size, color, margin, length }: SeparatorStyleArgs,
): CSSObject => {
  const isHorizontal = orientation === 'horizontal';
  const thickness = separatorThickness(size);
  const resolvedColor = color || theme.palette.divider;

  // A margin given as a string carries its own units; a number is pixels.
  const marginValue = separatorMargin(size, margin);
  const marginStr = typeof marginValue === 'string' ? marginValue : `${marginValue}px`;

  const baseStyles: CSSObject = {
    display: 'flex',
    alignItems: 'center',
    margin: isHorizontal ? `${marginStr} 0` : `0 ${marginStr}`,
    width: isHorizontal ? length || '100%' : `${thickness}px`,
    height: isHorizontal ? `${thickness}px` : length || '100%',
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
