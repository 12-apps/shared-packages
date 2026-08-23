import SuccessIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import WarningIcon from '@mui/icons-material/Warning';
import {
  alpha,
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';
import React from 'react';

import type { SonnerItem } from './Sonner.types';
import type { SonnerProps } from './Sonner.types';

const renderToastIcon = (icon: SonnerProps['icon'], type: SonnerProps['type']) => {
  if (icon) return icon;

  switch (type) {
    case 'success':
      return <SuccessIcon sx={{ fontSize: 20, color: 'success.main' }} />;
    case 'error':
      return <ErrorIcon sx={{ fontSize: 20, color: 'error.main' }} />;
    case 'warning':
      return <WarningIcon sx={{ fontSize: 20, color: 'warning.main' }} />;
    case 'info':
      return <InfoIcon sx={{ fontSize: 20, color: 'info.main' }} />;
    case 'loading':
      return <CircularProgress size={16} />;
    default:
      return null;
  }
};

// Errors and toasts flagged important interrupt the screen reader; the rest wait
// for the next pause. Computed once instead of duplicating the same condition
// across the role and aria-live attributes.
const resolveToastAnnouncement = (important: boolean, type: SonnerProps['type']) => {
  const interrupts = important || type === 'error';

  return {
    role: interrupts ? 'alert' : 'status',
    live: (interrupts ? 'assertive' : 'polite') as 'assertive' | 'polite',
  };
};

const buildToastStyles = (
  theme: Theme,
  variant: SonnerProps['variant'],
  visible: boolean,
): CSSObject => {
  const baseStyles: CSSObject = {
    borderRadius: theme.spacing(1.5),
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    boxShadow: theme.shadows[4],
    transition: theme.transitions.create(['all', 'transform', 'opacity'], {
      duration: theme.transitions.duration.short,
    }),
    transform: visible ? 'scale(1)' : 'scale(0.95)',
    opacity: visible ? 1 : 0,
  };

  switch (variant) {
    case 'glass':
      return {
        ...baseStyles,
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
        boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.1)}`,
      };

    case 'minimal':
      return {
        ...baseStyles,
        backgroundColor: theme.palette.background.default,
        border: 'none',
        boxShadow: 'none',
        borderLeft: `4px solid ${theme.palette.primary.main}`,
        borderRadius: 0,
      };

    default:
      return baseStyles;
  }
};

// Title, description and the optional action row. Split out so the toast shell
// keeps only its own concerns — announcement, styling and dismissal.
const ToastContent: React.FC<{
  title?: SonnerProps['title'];
  description?: SonnerProps['description'];
  important: boolean;
  action?: SonnerProps['action'];
  cancel?: SonnerProps['cancel'];
}> = ({ title, description, important, action, cancel }) => (
  <Box sx={{ flex: 1, minWidth: 0 }}>
    {title && (
      <Typography
        variant="body2"
        sx={{
          fontWeight: important ? 600 : 500,
          color: 'text.primary',
          mb: description ? 0.5 : 0,
        }}
      >
        {title}
      </Typography>
    )}

    {description && (
      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
        {description}
      </Typography>
    )}

    {(action || cancel) && (
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        {action && (
          <ToastActionButton action={action} buttonVariant="contained" />
        )}
        {cancel && <ToastActionButton action={cancel} buttonVariant="outlined" />}
      </Box>
    )}
  </Box>
);

const ToastActionButton: React.FC<{
  action: NonNullable<SonnerProps['action']>;
  buttonVariant: 'contained' | 'outlined';
}> = ({ action, buttonVariant }) => (
  <Button
    size="small"
    onClick={action.onClick}
    variant={buttonVariant}
    sx={{ fontSize: '0.75rem', py: 0.5, px: 1.5 }}
  >
    {action.label}
  </Button>
);

export const SonnerToast: React.FC<SonnerItem & { onDismiss: (id: string) => void }> = ({
  id,
  title,
  description,
  type = 'default',
  variant = 'default',
  closable = true,
  dismissLabel,
  action,
  cancel,
  icon,
  important = false,
  visible,
  onDismiss,
}) => {
  const theme = useTheme();
  const announcement = resolveToastAnnouncement(important, type);

  const handleDismiss = () => {
    onDismiss(id);
  };

  return (
    <Collapse in={visible} timeout={200}>
      <Box
        role={announcement.role}
        aria-live={announcement.live}
        aria-atomic="true"
        sx={{
          ...buildToastStyles(theme, variant, visible),
          p: 2,
          mb: 1,
          minWidth: 356,
          maxWidth: 400,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
        }}
      >
        {renderToastIcon(icon, type)}

        <ToastContent
          title={title}
          description={description}
          important={important}
          action={action}
          cancel={cancel}
        />

        {closable && (
          <IconButton
            size="small"
            onClick={handleDismiss}
            aria-label={dismissLabel}
            sx={{
              ml: 'auto',
              color: 'text.secondary',
              '&:hover': {
                backgroundColor: 'action.hover',
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Collapse>
  );
};
