import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import {
  ERROR_ICON_BOX,
  ERROR_ICON_BOX_OPACITY,
  ERROR_ICON_SIZE,
  ERROR_MESSAGE_LINE_HEIGHT,
  ERROR_MESSAGE_MAX_WIDTH,
  ERROR_STATE_GAP_UNITS,
  ERROR_STATE_MIN_HEIGHT,
  ERROR_STATE_PADDING_UNITS,
  ERROR_TEXT_GAP_UNITS,
  RETRY_MARGIN_TOP_UNITS,
  RETRY_MIN_WIDTH,
} from './ErrorState.metrics';
import type { ErrorStateProps, ErrorStateSeverity } from './ErrorState.types';
import { resolveTestId } from '../../../platform/test-id';

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
        width: ERROR_ICON_BOX,
        height: ERROR_ICON_BOX,
        borderRadius: '50%',
        backgroundColor: color.light,
        opacity: ERROR_ICON_BOX_OPACITY,
      }}
    >
      {icon || <Fallback sx={{ fontSize: ERROR_ICON_SIZE, color: color.main }} />}
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
    <Stack spacing={ERROR_TEXT_GAP_UNITS} alignItems="center">
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
          maxWidth: ERROR_MESSAGE_MAX_WIDTH,
          lineHeight: ERROR_MESSAGE_LINE_HEIGHT,
        }}
      >
        {message}
      </Typography>
    </Stack>
  );
};

export const ErrorState: React.FC<ErrorStateProps> = React.memo((props) => {
  const {
    message,
    title,
    onRetry,
    retryLabel = 'Retry',
    severity = 'error',
    icon,
    className,
  } = props;
  const theme = useTheme();
  const titleId = React.useId();
  // `dataTestId` is the documented spelling; `testID`, the shared contract's
  // other one, resolves to the same id.
  const dataTestId = resolveTestId(props);
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
        padding: theme.spacing(ERROR_STATE_PADDING_UNITS),
        minHeight: ERROR_STATE_MIN_HEIGHT,
        gap: theme.spacing(ERROR_STATE_GAP_UNITS),
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
            mt: theme.spacing(RETRY_MARGIN_TOP_UNITS),
            minWidth: RETRY_MIN_WIDTH,
          }}
        >
          {retryLabel}
        </Button>
      )}
    </Box>
  );
});

ErrorState.displayName = 'ErrorState';

export default ErrorState;
