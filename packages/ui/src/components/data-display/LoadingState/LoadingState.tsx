import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { Skeleton } from '../../layout/Skeleton/Skeleton';

import {
  makeTestIds,
  resolveLoadingStateProps,
  SIZE_MAP,
  SKELETON_ROW_HEIGHT,
} from './LoadingState.helpers';
import {
  SKELETON_FULL_ROW_WIDTH,
  SKELETON_LAST_ROW_WIDTH,
  SKELETON_MESSAGE_MARGIN_TOP_UNITS,
  SKELETON_PADDING_UNITS,
  SKELETON_RADIUS,
  SKELETON_ROW_GAP_UNITS,
  SPINNER_GAP_UNITS,
  SPINNER_MIN_HEIGHT,
  SPINNER_PADDING_UNITS,
} from './LoadingState.metrics';
import type { LoadingStateProps, LoadingStateSize } from './LoadingState.types';
import { resolveTestId } from '../../../platform/test-id';

interface ViewProps {
  message?: string;
  size: LoadingStateSize;
  skeletonRows: number;
  className?: string;
  testIds: ReturnType<typeof makeTestIds>;
}

const LoadingMessage: React.FC<{
  message?: string;
  size: LoadingStateSize;
  testIds: ViewProps['testIds'];
  sx?: object;
}> = ({ message, size, testIds, sx }) =>
  message ? (
    <Typography
      variant={SIZE_MAP[size].text}
      color="text.secondary"
      sx={sx}
      data-testid={testIds.named('message')}
    >
      {message}
    </Typography>
  ) : null;

const SkeletonView: React.FC<ViewProps> = ({
  message,
  size,
  skeletonRows,
  className,
  testIds,
}) => {
  const theme = useTheme();

  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={message || 'Loading content'}
      className={className}
      data-testid={testIds.base}
      sx={{
        width: '100%',
        padding: theme.spacing(SKELETON_PADDING_UNITS),
      }}
    >
      <Stack spacing={SKELETON_ROW_GAP_UNITS}>
        {Array.from({ length: skeletonRows }).map((_, index) => (
          <Skeleton
            key={`skeleton-row-${index}`}
            variant="rectangular"
            animation="wave"
            height={SKELETON_ROW_HEIGHT[size]}
            // The last row is short, so the block reads as a paragraph of text.
            width={index === skeletonRows - 1 ? SKELETON_LAST_ROW_WIDTH : SKELETON_FULL_ROW_WIDTH}
            borderRadius={SKELETON_RADIUS}
            data-testid={testIds.optional(`skeleton-${index}`)}
          />
        ))}
      </Stack>
      <LoadingMessage
        message={message}
        size={size}
        testIds={testIds}
        sx={{ mt: SKELETON_MESSAGE_MARGIN_TOP_UNITS, textAlign: 'center' }}
      />
    </Box>
  );
};

const SpinnerView: React.FC<ViewProps> = ({ message, size, className, testIds }) => {
  const theme = useTheme();

  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={message || 'Loading'}
      className={className}
      data-testid={testIds.base}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing(SPINNER_PADDING_UNITS),
        minHeight: SPINNER_MIN_HEIGHT,
        gap: theme.spacing(SPINNER_GAP_UNITS),
      }}
    >
      <CircularProgress
        size={SIZE_MAP[size].spinner}
        data-testid={testIds.named('spinner')}
      />
      <LoadingMessage message={message} size={size} testIds={testIds} />
    </Box>
  );
};

export const LoadingState: React.FC<LoadingStateProps> = React.memo((rawProps) => {
  const resolved = resolveLoadingStateProps(rawProps);
  const { variant, message, size, skeletonRows, className } = resolved;
  const viewProps: ViewProps = {
    message,
    size,
    skeletonRows,
    className,
    // `dataTestId` is the documented spelling; `testID`, the shared contract's
    // other one, resolves to the same id.
    testIds: makeTestIds(resolveTestId(resolved)),
  };

  return variant === 'skeleton' ? (
    <SkeletonView {...viewProps} />
  ) : (
    <SpinnerView {...viewProps} />
  );
});

LoadingState.displayName = 'LoadingState';

export default LoadingState;
