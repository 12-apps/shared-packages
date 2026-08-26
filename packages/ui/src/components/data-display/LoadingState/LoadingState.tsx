import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import React from 'react';

import { Skeleton } from '../../layout/Skeleton/Skeleton';

import {
  makeTestIds,
  resolveLoadingStateProps,
  SIZE_MAP,
  SKELETON_ROW_HEIGHT,
} from './LoadingState.helpers';
import type { LoadingStateProps, LoadingStateSize } from './LoadingState.types';

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
        padding: theme.spacing(3),
      }}
    >
      <Stack spacing={2}>
        {Array.from({ length: skeletonRows }).map((_, index) => (
          <Skeleton
            key={`skeleton-row-${index}`}
            variant="rectangular"
            animation="wave"
            height={SKELETON_ROW_HEIGHT[size]}
            // The last row is short, so the block reads as a paragraph of text.
            width={index === skeletonRows - 1 ? '60%' : '100%'}
            borderRadius={4}
            data-testid={testIds.optional(`skeleton-${index}`)}
          />
        ))}
      </Stack>
      <LoadingMessage
        message={message}
        size={size}
        testIds={testIds}
        sx={{ mt: 2, textAlign: 'center' }}
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
        padding: theme.spacing(6),
        minHeight: 200,
        gap: theme.spacing(2),
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
  const { variant, message, size, skeletonRows, className, dataTestId } =
    resolveLoadingStateProps(rawProps);
  const viewProps: ViewProps = {
    message,
    size,
    skeletonRows,
    className,
    testIds: makeTestIds(dataTestId),
  };

  return variant === 'skeleton' ? (
    <SkeletonView {...viewProps} />
  ) : (
    <SpinnerView {...viewProps} />
  );
});

LoadingState.displayName = 'LoadingState';

export default LoadingState;
