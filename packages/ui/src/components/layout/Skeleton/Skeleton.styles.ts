import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import type { SkeletonProps } from './Skeleton.types';

type SkeletonVariant = NonNullable<SkeletonProps['variant']>;
type SkeletonIntensity = NonNullable<SkeletonProps['intensity']>;

/** `wave` is our own name for a rectangle that animates; MUI has no such variant. */
export const muiVariantFor = (
  variant: SkeletonVariant,
): 'circular' | 'rectangular' | 'text' => {
  switch (variant) {
    case 'circular':
      return 'circular';
    case 'rectangular':
    case 'wave':
      return 'rectangular';
    default:
      return 'text';
  }
};

export const muiAnimationFor = (
  variant: SkeletonVariant,
  animation: SkeletonProps['animation'],
) => {
  if (variant === 'wave') return 'wave';
  return animation;
};

export const defaultDimensions = (
  variant: SkeletonVariant,
): { width: number | string; height: number | undefined } => {
  switch (variant) {
    case 'circular':
      return { width: 40, height: 40 };
    case 'rectangular':
    case 'wave':
      return { width: '100%', height: 40 };
    default:
      return { width: '100%', height: undefined };
  }
};

const INTENSITY_OPACITY: Record<SkeletonIntensity, number> = {
  low: 0.11,
  medium: 0.13,
  high: 0.15,
};

const intensityOpacity = (intensity: SkeletonIntensity): number =>
  INTENSITY_OPACITY[intensity] ?? INTENSITY_OPACITY.medium;

const glassmorphismStyles = (theme: Theme): CSSObject => ({
  background: `linear-gradient(135deg,
        ${alpha(theme.palette.background.paper, 0.8)} 0%,
        ${alpha(theme.palette.background.paper, 0.4)} 100%)`,
  backdropFilter: 'blur(20px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  boxShadow: `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.1)}`,
});

// The sweep is a pseudo-element sliding across the box, so the box has to clip it
// and establish a positioning context — hence `position`/`overflow` below.
const shimmerStyles = (theme: Theme): CSSObject => ({
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    background: `linear-gradient(
          90deg,
          transparent,
          ${alpha(theme.palette.common.white, 0.3)},
          transparent
        )`,
    transform: 'translateX(-100%)',
    animation: 'shimmer 2s infinite',
  },
  '@keyframes shimmer': {
    '100%': {
      transform: 'translateX(100%)',
    },
  },
});

interface SkeletonStyleArgs {
  intensity: SkeletonIntensity;
  borderRadius?: number | string;
  glassmorphism: boolean;
  shimmer: boolean;
  style?: React.CSSProperties;
}

export const skeletonStyles = (
  theme: Theme,
  { intensity, borderRadius, glassmorphism, shimmer, style }: SkeletonStyleArgs,
): CSSObject => ({
  borderRadius,
  backgroundColor: alpha(
    theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.text.primary,
    intensityOpacity(intensity),
  ),
  ...(shimmer && {
    position: 'relative' as const,
    overflow: 'hidden' as const,
  }),
  ...(glassmorphism ? glassmorphismStyles(theme) : {}),
  ...(shimmer ? shimmerStyles(theme) : {}),
  ...style,
});
