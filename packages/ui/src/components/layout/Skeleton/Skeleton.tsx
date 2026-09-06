import Box from '@mui/material/Box/index.js';
import MuiSkeleton from '@mui/material/Skeleton/index.js';
import Stack from '@mui/material/Stack/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { resolveSkeletonProps, skeletonInstanceTestId } from './Skeleton.helpers';
import {
  defaultDimensions,
  muiAnimationFor,
  muiVariantFor,
  skeletonStyles,
} from './Skeleton.styles';
import type { SkeletonProps } from './Skeleton.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';

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
    style,
    ...others
  } = resolveSkeletonProps(rawProps);
  // `testID` and `dataTestId` are the shared contract's spellings; the DOM
  // wants `data-testid`, and must not see the other two as attributes.
  const dataTestId = resolveTestId(others);
  const props = withoutTestIdProps(others);
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
            'data-testid': skeletonInstanceTestId(dataTestId, index),
          })}
        </Box>
      ))}
    </Stack>
  );
});

Skeleton.displayName = 'Skeleton';
