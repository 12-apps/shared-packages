import SuccessIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import WarningIcon from '@mui/icons-material/Warning';
import type { Theme } from '@mui/material/styles/index.js';
import Alert from '@mui/material/Alert/index.js';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Portal from '@mui/material/Portal/index.js';
import Slide from '@mui/material/Slide/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import React, { createContext, useCallback,useContext, useState } from 'react';

import type { ToastContainerProps, ToastContextType, ToastItem,ToastProps } from './Toast.types';

const ToastContext = createContext<ToastContextType | null>(null);

type PromiseToastOptions<T> = {
  loading: string;
  success: string | ((data: T) => string);
  error: string | ((error: unknown) => string);
};

// success/error may be a literal or a formatter over the settled value.
const resolveToastMessage = <T,>(message: string | ((value: T) => string), value: T): string =>
  typeof message === 'function' ? message(value) : message;

// Shows a persistent "loading" toast for the life of a promise, then swaps it
// for a success or error one. Lives outside the provider so the provider body
// stays readable; it takes add/remove rather than reaching for context.
const trackPromiseWithToasts = async <T,>(
  promiseToResolve: Promise<T>,
  options: PromiseToastOptions<T>,
  addToast: (toast: Omit<ToastProps, 'id'>) => string,
  removeToast: (id: string) => void,
): Promise<T> => {
  const toastId = addToast({
    message: options.loading,
    variant: 'promise',
    persistent: true,
  });

  try {
    const data = await promiseToResolve;

    removeToast(toastId);
    addToast({ message: resolveToastMessage(options.success, data), variant: 'success' });

    return data;
  } catch (error) {
    removeToast(toastId);
    addToast({ message: resolveToastMessage(options.error, error), variant: 'error' });

    throw error;
  }
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastProps, 'id'>): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newToast: ToastItem = {
        ...toast,
        id,
        timestamp: Date.now(),
      };

      setToasts((prev) => [...prev, newToast]);

      if (!toast.persistent && toast.duration !== 0) {
        const duration = toast.duration ?? 5000;
        window.setTimeout(() => {
          removeToast(id);
        }, duration);
      }

      return id;
    },
    [removeToast],
  );

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const promise = useCallback(
    <T,>(promiseToResolve: Promise<T>, options: PromiseToastOptions<T>): Promise<T> =>
      trackPromiseWithToasts(promiseToResolve, options, addToast, removeToast),
    [addToast, removeToast],
  );

  const contextValue: ToastContextType = {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
    promise,
  };

  return <ToastContext.Provider value={contextValue}>{children}</ToastContext.Provider>;
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const renderVariantIcon = (variant: ToastProps['variant']) => {
  switch (variant) {
    case 'success':
      return <SuccessIcon />;
    case 'error':
      return <ErrorIcon />;
    case 'warning':
      return <WarningIcon />;
    case 'info':
      return <InfoIcon />;
    case 'promise':
      return <CircularProgress size={20} />;
    default:
      return null;
  }
};

// 'default' and 'promise' have no MUI severity of their own; both read as info.
const toAlertSeverity = (variant: ToastProps['variant']) =>
  variant === 'default' || variant === 'promise' ? 'info' : variant;

const buildToastStyles = (theme: Theme, glass: boolean) => {
  const baseStyles = {
    borderRadius: theme.spacing(1.5),
    transition: theme.transitions.create(['background-color', 'backdrop-filter'], {
      duration: theme.transitions.duration.standard,
    }),
  };

  if (glass) {
    return {
      ...baseStyles,
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
    };
  }

  return baseStyles;
};

export const Toast: React.FC<ToastProps> = ({
  id = '',
  message,
  variant = 'default',
  closable = true,
  action,
  glass = false,
  onClose,
  dataTestId = 'toast',
}) => {
  const theme = useTheme();

  const handleClose = () => {
    if (onClose && id) {
      onClose(id);
    }
  };

  return (
    <Alert
      data-testid={dataTestId}
      icon={renderVariantIcon(variant)}
      severity={toAlertSeverity(variant)}
      onClose={closable ? handleClose : undefined}
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {action && (
            <Button
              data-testid={`${dataTestId}-action`}
              color="inherit"
              size="small"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {closable && (
            <IconButton
              data-testid={`${dataTestId}-close`}
              aria-label="close"
              color="inherit"
              size="small"
              onClick={handleClose}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      }
      sx={buildToastStyles(theme, glass)}
    >
      <Typography data-testid={`${dataTestId}-message`} variant="body2">{message}</Typography>
    </Alert>
  );
};

export const ToastContainer: React.FC<ToastContainerProps> = ({
  position = 'top-right',
  maxToasts = 5,
  gap = 8,
  className,
  dataTestId = 'toast-container',
}) => {
  const context = useContext(ToastContext);
  
  if (!context) {
    throw new Error('ToastContainer must be used within a ToastProvider');
  }

  const { toasts, removeToast } = context;

  const getPositionStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: `${gap}px`,
      padding: '16px',
      pointerEvents: 'none',
    };

    switch (position) {
      case 'top-left':
        return { ...baseStyles, top: 0, left: 0 };
      case 'top-center':
        return { ...baseStyles, top: 0, left: '50%', transform: 'translateX(-50%)' };
      case 'top-right':
        return { ...baseStyles, top: 0, right: 0 };
      case 'bottom-left':
        return { ...baseStyles, bottom: 0, left: 0, flexDirection: 'column-reverse' };
      case 'bottom-center':
        return {
          ...baseStyles,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          flexDirection: 'column-reverse',
        };
      case 'bottom-right':
        return { ...baseStyles, bottom: 0, right: 0, flexDirection: 'column-reverse' };
      default:
        return { ...baseStyles, top: 0, right: 0 };
    }
  };

  return (
    <Portal>
      <Box data-testid={dataTestId} className={className} sx={getPositionStyles()}>
        {toasts.slice(0, maxToasts).map((toast, index) => (
          <Slide
            key={toast.id}
            direction={position.includes('left') ? 'right' : 'left'}
            in={true}
            timeout={300}
            style={{ pointerEvents: 'auto' }}
          >
            <Box data-testid={`${dataTestId}-item-${index}`}>
              <Toast {...toast} onClose={removeToast} dataTestId={toast.dataTestId || `toast-${index}`} />
            </Box>
          </Slide>
        ))}
      </Box>
    </Portal>
  );
};
