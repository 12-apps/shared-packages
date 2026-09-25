import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { CarouselProps } from './Carousel.types';
import { accentFor, rem, sxRem } from '../../../tokens/scales';

type Variant = NonNullable<CarouselProps['variant']>;
type Size = NonNullable<CarouselProps['size']>;
type Color = NonNullable<CarouselProps['color']>;

const SIZES: Record<Size, { height: (theme: Theme) => string; fontSize: (theme: Theme) => string }> = {
  xs: { height: sxRem(200), fontSize: sxRem(12) },
  sm: { height: sxRem(300), fontSize: sxRem(14) },
  md: { height: sxRem(400), fontSize: sxRem(16) },
  lg: { height: sxRem(500), fontSize: sxRem(18) },
  xl: { height: sxRem(600), fontSize: sxRem(20) },
};

const sizeStyles = (size: Size) => SIZES[size] ?? SIZES.md;

/**
 * The frame's box as CSS. A numeric `height`/`width` is design px, drawn
 * through the type scale; an unset height is the documented 400. A numeric
 * height is taken literally; any other falls back to the size preset, since a
 * percentage cannot resolve against an unsized parent here. A string width
 * passes through.
 */
export const frameBox = (
  theme: Theme,
  size: Size,
  height: number | string | undefined,
  width: number | string,
): { width: string; height: string } => ({
  width: typeof width === 'number' ? rem(theme, width) : width,
  height: typeof height === 'number' || height === undefined
    ? rem(theme, height ?? 400)
    : sizeStyles(size).height(theme),
});

interface ContainerStyleInput {
  theme: Theme;
  variant: Variant;
  size: Size;
  color: Color;
  /** The frame's box, resolved by {@link frameBox}. */
  height: string;
  width: string;
  glow: boolean;
  pulse: boolean;
  glass: boolean;
  gradient: boolean;
}

/**
 * Each variant's own additions to the shared frame. The old switch re-spread the
 * same base, glow and pulse objects in all six arms before adding these; only
 * these differ, so the shared prefix is applied once by `containerStyles`.
 */
const SURFACES: Record<Variant, (input: ContainerStyleInput) => CSSObject> = {
  glass: ({ theme, color, glass }) => ({
    backgroundColor: alpha(theme.palette.background.paper, glass ? 0.1 : 0.9),
    backdropFilter: `blur(${rem(theme, 20)})`,
    border: `1px solid ${alpha(accentFor(theme, color).main, 0.2)}`,
  }),

  gradient: ({ theme, color, gradient }) => ({
    background: gradient
      ? `linear-gradient(135deg, ${alpha(accentFor(theme, color).light, 0.1)}, ${alpha(accentFor(theme, color).dark, 0.1)})`
      : 'transparent',
  }),

  elevated: ({ theme }) => ({ boxShadow: theme.shadows[8] }),

  minimal: () => ({ border: 'none', boxShadow: 'none' }),

  cards: ({ theme }) => ({ padding: theme.spacing(2) }),

  default: () => ({}),
};

export const containerStyles = (input: ContainerStyleInput): CSSObject => {
  const { theme, variant, color, height, width, glow, pulse } = input;
  const accent = accentFor(theme, color).main;

  return {
    position: 'relative' as const,
    width,
    height,
    overflow: 'hidden',
    borderRadius: theme.spacing(1),
    transition: theme.transitions.create(['all'], {
      duration: theme.transitions.duration.standard,
    }),
    ...(glow && { boxShadow: `0 0 ${rem(theme, 30)} ${alpha(accent, 0.4)}` }),
    ...(pulse && {
      animation: 'pulse 2s infinite',
      '@keyframes pulse': {
        '0%': { boxShadow: `0 0 0 0 ${alpha(accent, 0.4)}` },
        '70%': { boxShadow: `0 0 0 ${rem(theme, 20)} ${alpha(accent, 0)}` },
        '100%': { boxShadow: `0 0 0 0 ${alpha(accent, 0)}` },
      },
    }),
    ...(SURFACES[variant] ?? SURFACES.default)(input),
  };
};
