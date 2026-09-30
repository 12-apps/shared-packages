import Alert from '@mui/material/Alert/index.js';
import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';

import type { InfiniteScrollProps } from './InfiniteScroll.types';

type Variant = NonNullable<InfiniteScrollProps['variant']>;

const CENTERED: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  p: 2,
};

export const DefaultLoader: React.FC<{ loadingText: string }> = ({ loadingText }) => {
  const theme = useTheme();
  return (
    <Box sx={CENTERED}>
      <CircularProgress size={rem(theme, 24)} />
      <Typography variant="body2" sx={{ ml: 1 }}>
        {loadingText}
      </Typography>
    </Box>
  );
};

export const DefaultEndMessage: React.FC<{ endText: string }> = ({ endText }) => (
  <Box sx={CENTERED}>
    <Typography variant="body2" color="text.secondary">
      {endText}
    </Typography>
  </Box>
);

export const DefaultError: React.FC<{ error: Error }> = ({ error }) => (
  <Alert severity="error" sx={{ m: 2 }}>
    {error.message || 'An error occurred while loading more items'}
  </Alert>
);

/**
 * The horizontal variant's `width` as CSS: a number of 1 or less stays the
 * fraction `sx` reads it as, a larger one is design px, a string is as given;
 * unset (or 0) fills the parent.
 */
const horizontalWidth = (theme: Theme, width: number | string | undefined): string => {
  if (!width) return '100%';
  if (typeof width !== 'number') return width;
  return width <= 1 ? `${width * 100}%` : rem(theme, width);
};

/**
 * `horizontal` scrolls along a row; `reverse` stacks bottom-up, for a chat log
 * that loads older messages as you scroll away from the newest.
 */
export const containerStyles = (theme: Theme, variant: Variant, width?: number | string) => {
  const horizontal = variant === 'horizontal';
  const base = {
    width: horizontal ? horizontalWidth(theme, width) : '100%',
    height: horizontal ? '100%' : 'auto',
    overflowX: horizontal ? 'auto' : 'hidden',
    overflowY: horizontal ? 'hidden' : 'visible',
    display: 'flex',
    flexDirection: horizontal ? 'row' : 'column',
  };

  return variant === 'reverse' ? { ...base, flexDirection: 'column-reverse' } : base;
};
