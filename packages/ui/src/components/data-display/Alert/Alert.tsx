import CheckCircle from '@mui/icons-material/CheckCircle';
import Close from '@mui/icons-material/Close';
import Error from '@mui/icons-material/Error';
import Info from '@mui/icons-material/Info';
import Warning from '@mui/icons-material/Warning';
import {
  Alert as MuiAlert,
  AlertTitle,
  alpha,
  Box,
  Collapse,
  IconButton,
  keyframes,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { styled } from '@mui/material/styles';
import React from 'react';

import {
  alertEmphasisStyles,
  alertVariantStyles,
  fadeInScale,
  getColorFromTheme,
  getVariantIcon,
  iconRotate,
  pulseAnimation,
  shimmerAnimation,
} from './Alert.styles';
import type { AlertColor } from '@mui/material';
import type { AlertProps } from './Alert.types';

// Define animations
const StyledAlert = styled(MuiAlert, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customColor', 'glow', 'pulse', 'animate'].includes(prop as string),
})<{
  customVariant?: string;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
  animate?: boolean;
}>(({ theme, customVariant, customColor, glow, pulse, animate }) => {
  const colorPalette = getColorFromTheme(theme, customColor || customVariant || 'info');

  return {
    borderRadius: theme.spacing(1.5),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    overflow: 'hidden',
    animation: animate ? `${fadeInScale} 0.3s ease-out` : 'none',
    willChange: 'transform, opacity',

    // Enhanced base styles
    '.MuiAlert-message': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      fontSize: '0.95rem',
      lineHeight: 1.5,
    },

    '.MuiAlert-icon': {
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      alignItems: 'center',
      animation: animate ? `${iconRotate} 0.6s ease-out` : 'none',
    },

    // Hover effects
    '&:hover': {
      transform: 'translateY(-3px) scale(1.01)',
      boxShadow: `0 8px 20px ${alpha(colorPalette.main, 0.2)}`,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',

      '.MuiAlert-icon': {
        transform: 'scale(1.15) rotate(10deg)',
      },

      '&::before': {
        opacity: 1,
      },
    },

    // Active state
    '&:active': {
      transform: 'translateY(-1px) scale(0.99)',
      transition: 'transform 0.1s ease',
    },

    // Focus styles for accessibility
    '&:focus-within': {
      outline: `3px solid ${alpha(colorPalette.main, 0.5)}`,
      outlineOffset: '3px',
      boxShadow: `0 0 0 6px ${alpha(colorPalette.main, 0.1)}`,
      transition: 'all 0.2s ease',
    },

    ...alertVariantStyles(theme, customVariant, colorPalette),
    ...alertEmphasisStyles(colorPalette, Boolean(glow), Boolean(pulse)),
  };
});

const ALERT_DEFAULTS = {
  variant: 'info',
  glow: false,
  pulse: false,
  showIcon: true,
  closable: false,
  animate: true,
  role: 'alert',
  'aria-atomic': 'true',
  'data-testid': 'alert',
} satisfies Partial<AlertProps>;

// Strips explicitly-undefined props before the merge so `prop={undefined}` still
// falls back to the default, the way a destructuring default would.
const definedProps = (props: AlertProps): Partial<AlertProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<AlertProps>;

const testIdFor = (base: string | undefined, suffix: string) =>
  base ? `${base}-${suffix}` : `alert-${suffix}`;

// glass and gradient are our own looks with no MUI severity of their own; both
// borrow info's. danger is MUI's error.
const MUI_SEVERITY: Record<string, AlertColor> = {
  danger: 'error',
  glass: 'info',
  gradient: 'info',
};

const toMuiSeverity = (variant: string): AlertColor =>
  MUI_SEVERITY[variant] ?? (variant as AlertColor);

const AlertContent: React.FC<{
  title?: AlertProps['title'];
  description?: AlertProps['description'];
  dataTestId?: string;
  children?: React.ReactNode;
}> = ({ title, description, dataTestId, children }) => (
  <>
    {title && (
      <AlertTitle
        data-testid={testIdFor(dataTestId, 'title')}
        sx={{
          fontWeight: 600,
          fontSize: '1.05rem',
          marginBottom: description ? 0.5 : 0,
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {title}
      </AlertTitle>
    )}
    {description && (
      <Box
        component="div"
        data-testid={testIdFor(dataTestId, 'message')}
        sx={{
          opacity: 0.9,
          fontSize: '0.925rem',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {description}
      </Box>
    )}
    {children}
  </>
);

const AlertCloseButton: React.FC<{ dataTestId?: string; onClose: () => void }> = ({
  dataTestId,
  onClose,
}) => (
  <IconButton
    data-testid={testIdFor(dataTestId, 'close')}
    aria-label="close alert"
    color="inherit"
    size="small"
    onClick={onClose}
    sx={(theme) => ({
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: 0.7,
      '&:hover': {
        transform: 'rotate(90deg) scale(1.1)',
        opacity: 1,
        backgroundColor: alpha(theme.palette.action.hover, 0.1),
      },
      '&:focus': {
        opacity: 1,
        outline: 'none',
        backgroundColor: alpha(theme.palette.action.focus, 0.1),
      },
    })}
  >
    <Close fontSize="inherit" />
  </IconButton>
);

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    alertProps,
    ref,
  ) => {
    const {
      variant,
      color,
      glow,
      pulse,
      icon,
      showIcon,
      closable,
      onClose,
      title,
      description,
      children,
      animate,
      role,
      'aria-atomic': ariaAtomic,
      'data-testid': dataTestId,
      ...props
    } = { ...ALERT_DEFAULTS, ...definedProps(alertProps) };

    // Depends on `variant`, so it cannot live in the static defaults above.
    const ariaLive = alertProps['aria-live'] ?? (variant === 'danger' ? 'assertive' : 'polite');

    const [open, setOpen] = React.useState(true);
    const [isClosing, setIsClosing] = React.useState(false);

    const handleClose = () => {
      setIsClosing(true);
      window.setTimeout(() => {
        setOpen(false);
        onClose?.();
      }, 200);
    };

    const severity = toMuiSeverity(variant);

    const displayIcon = showIcon ? (
      <Box component="span" data-testid={testIdFor(dataTestId, 'icon')}>
        {icon || getVariantIcon(variant)}
      </Box>
    ) : false;

    const content = (
      <AlertContent title={title} description={description} dataTestId={dataTestId}>
        {children}
      </AlertContent>
    );

    return (
      <Collapse in={open && !isClosing} timeout={300}>
        <StyledAlert
          ref={ref}
          data-testid={dataTestId || 'alert'}
          severity={severity}
          customVariant={variant}
          customColor={color}
          glow={glow}
          pulse={pulse}
          animate={animate}
          icon={displayIcon}
          role={role}
          aria-live={ariaLive}
          aria-atomic={ariaAtomic}
          tabIndex={0}
          action={closable && <AlertCloseButton dataTestId={dataTestId} onClose={handleClose} />}
          {...props}
        >
          {content}
        </StyledAlert>
      </Collapse>
    );
  },
);

Alert.displayName = 'Alert';
