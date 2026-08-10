import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import type { CarouselProps } from './Carousel.types';
import { accentFor } from '../../../tokens/scales';

type Variant = NonNullable<CarouselProps['variant']>;
type Size = NonNullable<CarouselProps['size']>;
type Color = NonNullable<CarouselProps['color']>;

const SIZES: Record<Size, { height: number; fontSize: string }> = {
  xs: { height: 200, fontSize: '0.75rem' },
  sm: { height: 300, fontSize: '0.875rem' },
  md: { height: 400, fontSize: '1rem' },
  lg: { height: 500, fontSize: '1.125rem' },
  xl: { height: 600, fontSize: '1.25rem' },
};

const sizeStyles = (size: Size) => SIZES[size] ?? SIZES.md;

interface ContainerStyleInput {
  theme: Theme;
  variant: Variant;
  size: Size;
  color: Color;
  height: number | string;
  width: number | string;
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
    backdropFilter: 'blur(20px)',
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
  const { theme, variant, size, color, height, width, glow, pulse } = input;
  const accent = accentFor(theme, color).main;

  return {
    position: 'relative' as const,
    width,
    // A numeric height is taken literally; anything else falls back to the size
    // preset, since a percentage cannot resolve against an unsized parent here.
    height: typeof height === 'number' ? height : sizeStyles(size).height,
    overflow: 'hidden',
    borderRadius: theme.spacing(1),
    transition: theme.transitions.create(['all'], {
      duration: theme.transitions.duration.standard,
    }),
    ...(glow && { boxShadow: `0 0 30px ${alpha(accent, 0.4)}` }),
    ...(pulse && {
      animation: 'pulse 2s infinite',
      '@keyframes pulse': {
        '0%': { boxShadow: `0 0 0 0 ${alpha(accent, 0.4)}` },
        '70%': { boxShadow: `0 0 0 20px ${alpha(accent, 0)}` },
        '100%': { boxShadow: `0 0 0 0 ${alpha(accent, 0)}` },
      },
    }),
    ...(SURFACES[variant] ?? SURFACES.default)(input),
  };
};
