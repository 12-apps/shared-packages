import { Box, Skeleton as MuiSkeleton, Stack, useTheme } from '@mui/material';
import React from 'react';

import { resolveSkeletonProps } from './Skeleton.helpers';
import {
  defaultDimensions,
  muiAnimationFor,
  muiVariantFor,
  skeletonStyles,
} from './Skeleton.styles';
import type { SkeletonProps } from './Skeleton.types';

export const Skeleton: React.FC<SkeletonProps> = React.memo((rawProps) => {
  const {
    variant,
    animation,
    width,
    height,
    count,
    spacing,
    borderRadius,
    className,
    intensity,
    glassmorphism,
    shimmer,
    'data-testid': dataTestId,
    style,
    ...props
  } = resolveSkeletonProps(rawProps);
  const theme = useTheme();

  const defaults = defaultDimensions(variant);
  const finalWidth = width ?? defaults.width;
  const finalHeight = height ?? defaults.height;

  // Handle edge case: count of 0 should render nothing
  if (count === 0) {
    return null;
  }

  const singleSkeleton = (
    <MuiSkeleton
      variant={muiVariantFor(variant)}
      animation={muiAnimationFor(variant, animation)}
      width={finalWidth}
      height={finalHeight}
      sx={skeletonStyles(theme, {
        intensity,
        borderRadius,
        glassmorphism,
        shimmer,
        style,
      })}
      className={className}
      data-testid={dataTestId}
      aria-hidden="true"
      {...props}
    />
  );

  if (count === 1) {
    return singleSkeleton;
  }

  return (
    <Stack spacing={spacing}>
      {Array.from({ length: count }).map((_, index) => (
        <Box key={`skeleton-${index}`}>
          {React.cloneElement(singleSkeleton, {
            'data-testid': dataTestId ? `${dataTestId}-${index}` : undefined,
          })}
        </Box>
      ))}
    </Stack>
  );
});

Skeleton.displayName = 'Skeleton';