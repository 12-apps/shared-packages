import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { SkeletonProps } from './Skeleton.types';
import {
  GLASS_BACKGROUND_ALPHA_FROM,
  GLASS_BACKGROUND_ALPHA_TO,
  GLASS_BLUR_PX,
  GLASS_BORDER_ALPHA,
  GLASS_SHADOW,
  SHIMMER_ALPHA,
  SHIMMER_DURATION_MS,
  SKELETON_DEFAULT_DIMENSIONS,
  SKELETON_INTENSITY_OPACITY,
} from './Skeleton.metrics';
import { modeInk, shadowInk, sheen } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

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

// Derived from the shared metrics, not restated: the native `Skeleton` reads
// the same table, so the two renderers cannot disagree on a default box.
export const defaultDimensions = (
  variant: SkeletonVariant,
): { width: number | string; height: number | undefined } =>
  // The `default:` arm the old switch had: an unrecognised variant used to fall
  // back rather than hand `undefined` to a caller that then reads `.width`.
  SKELETON_DEFAULT_DIMENSIONS[variant] ?? SKELETON_DEFAULT_DIMENSIONS.rectangular;

const intensityOpacity = (intensity: SkeletonIntensity): number =>
  SKELETON_INTENSITY_OPACITY[intensity] ?? SKELETON_INTENSITY_OPACITY.medium;

const glassmorphismStyles = (theme: Theme): CSSObject => ({
  background: `linear-gradient(135deg,
        ${alpha(theme.palette.background.paper, GLASS_BACKGROUND_ALPHA_FROM)} 0%,
        ${alpha(theme.palette.background.paper, GLASS_BACKGROUND_ALPHA_TO)} 100%)`,
  backdropFilter: `blur(${rem(theme, GLASS_BLUR_PX)})`,
  border: `1px solid ${alpha(theme.palette.divider, GLASS_BORDER_ALPHA)}`,
  boxShadow: `${rems(theme, 0, GLASS_SHADOW.offsetY, GLASS_SHADOW.blur, 0)} ${shadowInk(theme, GLASS_SHADOW.alpha)}`,
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
          ${sheen(theme, SHIMMER_ALPHA)},
          transparent
        )`,
    transform: 'translateX(-100%)',
    animation: `shimmer ${SHIMMER_DURATION_MS / 1000}s infinite`,
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

/**
 * A `width`/`height` for MUI's `Skeleton`, which writes it into an inline
 * `style`: a number there is px, so it is design px through the type scale.
 * The caller keeps a `0` as `0` (see `Skeleton.tsx`).
 */
export const skeletonLength = (theme: Theme, value: number | string | undefined): string | undefined =>
  typeof value === 'number' ? rem(theme, value) : value;

/** The skeleton's `sx` — so a number on `borderRadius` is a multiple of `shape.borderRadius`. */
export const skeletonSx = (
  theme: Theme,
  { intensity, borderRadius, glassmorphism, shimmer, style }: SkeletonStyleArgs,
): CSSObject => ({
  borderRadius,
  backgroundColor: alpha(
    theme.palette.mode === 'dark' ? modeInk(theme) : theme.palette.text.primary,
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
