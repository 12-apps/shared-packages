import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Box, Button, Stack, Typography, useTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import React from 'react';

import type { ErrorStateProps, ErrorStateSeverity } from './ErrorState.types';

const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `error-state-${suffix}`;

const paletteFor = (theme: Theme, severity: ErrorStateSeverity) =>
  severity === 'error' ? theme.palette.error : theme.palette.warning;

const ErrorIcon: React.FC<{
  severity: ErrorStateSeverity;
  icon?: React.ReactNode;
  testId: string;
}> = ({ severity, icon, testId }) => {
  const theme = useTheme();
  const color = paletteFor(theme, severity);
  const Fallback = severity === 'error' ? ErrorOutlineIcon : WarningAmberIcon;

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 80,
        height: 80,
        borderRadius: '50%',
        backgroundColor: color.light,
        opacity: 0.9,
      }}
    >
      {icon || <Fallback sx={{ fontSize: 48, color: color.main }} />}
    </Box>
  );
};

const ErrorText: React.FC<{
  title?: string;
  message: string;
  titleId: string;
  testId: (suffix: string) => string;
}> = ({ title, message, titleId, testId }) => {
  const theme = useTheme();

  return (
    <Stack spacing={1} alignItems="center">
      {title && (
        <Typography
          id={titleId}
          variant="h6"
          component="h3"
          data-testid={testId('title')}
          sx={{
            fontWeight: theme.typography.fontWeightMedium,
            color: theme.palette.text.primary,
          }}
        >
          {title}
        </Typography>
      )}

      <Typography
        id={`${titleId}-message`}
        variant="body2"
        color="text.secondary"
        data-testid={testId('message')}
        sx={{
          maxWidth: 400,
          lineHeight: 1.6,
        }}
      >
        {message}
      </Typography>
    </Stack>
  );
};

export const ErrorState: React.FC<ErrorStateProps> = React.memo(
  ({
    message,
    title,
    onRetry,
    retryLabel = 'Retry',
    severity = 'error',
    icon,
    className,
    dataTestId,
  }) => {
    const theme = useTheme();
    const titleId = React.useId();
    const testId = makeTestId(dataTestId);

    return (
      <Box
        role="alert"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={`${titleId}-message`}
        className={className}
        data-testid={dataTestId || 'error-state'}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: theme.spacing(6),
          minHeight: 200,
          gap: theme.spacing(2),
        }}
      >
        <ErrorIcon severity={severity} icon={icon} testId={testId('icon')} />

        <ErrorText title={title} message={message} titleId={titleId} testId={testId} />

        {onRetry && (
          <Button
            variant="outlined"
            color={severity}
            onClick={onRetry}
            startIcon={<RefreshIcon />}
            data-testid={testId('retry-button')}
            sx={{
              mt: theme.spacing(1),
              minWidth: 120,
            }}
          >
            {retryLabel}
          </Button>
        )}
      </Box>
    );
  },
);

ErrorState.displayName = 'ErrorState';

export default ErrorState;
