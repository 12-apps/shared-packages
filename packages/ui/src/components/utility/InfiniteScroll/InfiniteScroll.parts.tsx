import Alert from '@mui/material/Alert/index.js';
import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Typography from '@mui/material/Typography/index.js';
import React from 'react';

import type { InfiniteScrollProps } from './InfiniteScroll.types';

type Variant = NonNullable<InfiniteScrollProps['variant']>;

const CENTERED = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  p: 2,
} as const;

export const DefaultLoader: React.FC<{ loadingText: string }> = ({ loadingText }) => (
  <Box sx={CENTERED}>
    <CircularProgress size={24} />
    <Typography variant="body2" sx={{ ml: 1 }}>
      {loadingText}
    </Typography>
  </Box>
);

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
 * `horizontal` scrolls along a row; `reverse` stacks bottom-up, for a chat log
 * that loads older messages as you scroll away from the newest.
 */
export const containerStyles = (variant: Variant, width?: number | string) => {
  const horizontal = variant === 'horizontal';
  const base = {
    width: horizontal ? width || '100%' : '100%',
    height: horizontal ? '100%' : 'auto',
    overflowX: horizontal ? 'auto' : 'hidden',
    overflowY: horizontal ? 'hidden' : 'visible',
    display: 'flex',
    flexDirection: horizontal ? 'row' : 'column',
  };

  return variant === 'reverse' ? { ...base, flexDirection: 'column-reverse' } : base;
};
