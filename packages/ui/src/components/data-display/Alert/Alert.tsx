import Close from '@mui/icons-material/Close';
import MuiAlert from '@mui/material/Alert/index.js';
import AlertTitle from '@mui/material/AlertTitle/index.js';
import Box from '@mui/material/Box/index.js';
import Collapse from '@mui/material/Collapse/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import React from 'react';

import { defaultAriaLive, resolveAlertProps, testIdFor } from './Alert.helpers';
import {
  ACTIVE,
  ALERT_EASING,
  ALERT_RADIUS_UNITS,
  ALERT_TRANSITION_MS,
  CLOSE_BUTTON,
  CLOSE_DELAY_MS,
  COLLAPSE_MS,
  DESCRIPTION,
  FADE_IN,
  FOCUS,
  HOVER,
  seconds,
  TITLE,
} from './Alert.metrics';
import {
  alertEmphasisStyles,
  alertLayoutStyles,
  alertVariantStyles,
  fadeInScale,
  getColorFromTheme,
  getVariantIcon,
} from './Alert.styles';
import type { AlertColor } from '@mui/material/Alert/index.js';
import type { AlertProps } from './Alert.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { px } from '../../../tokens/theme';

const transition = `all ${seconds(ALERT_TRANSITION_MS)} ${ALERT_EASING}`;

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
    borderRadius: theme.spacing(ALERT_RADIUS_UNITS),
    transition,
    position: 'relative',
    overflow: 'hidden',
    animation: animate ? `${fadeInScale} ${seconds(FADE_IN.ms)} ease-out` : 'none',
    willChange: 'transform, opacity',

    ...alertLayoutStyles(theme, colorPalette, animate),

    // Hover effects
    '&:hover': {
      transform: `translateY(-${HOVER.lift}px) scale(${HOVER.scale})`,
      boxShadow: `0 ${HOVER.shadowY}px ${HOVER.shadowBlur}px ${alpha(colorPalette.main, HOVER.shadowAlpha)}`,
      transition,

      '.MuiAlert-icon': {
        transform: `scale(${HOVER.iconScale}) rotate(${HOVER.iconRotateDeg}deg)`,
      },

      '&::before': {
        opacity: 1,
      },
    },

    // Active state
    '&:active': {
      transform: `translateY(-${ACTIVE.lift}px) scale(${ACTIVE.scale})`,
      transition: `transform ${seconds(ACTIVE.ms)} ease`,
    },

    // Focus styles for accessibility
    '&:focus-within': {
      outline: `${FOCUS.ringWidth}px solid ${alpha(colorPalette.main, FOCUS.ringAlpha)}`,
      outlineOffset: `${FOCUS.offset}px`,
      boxShadow: `0 0 0 ${FOCUS.haloSpread}px ${alpha(colorPalette.main, FOCUS.haloAlpha)}`,
      transition: `all ${seconds(FOCUS.ms)} ease`,
    },

    ...alertVariantStyles(theme, customVariant, colorPalette),
    ...alertEmphasisStyles(colorPalette, Boolean(glow), Boolean(pulse)),
  };
});

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
          fontWeight: TITLE.fontWeight,
          fontSize: px(TITLE.fontSize),
          marginBottom: description ? TITLE.marginBottomUnits : 0,
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
          opacity: DESCRIPTION.opacity,
          fontSize: px(DESCRIPTION.fontSize),
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

const AlertCloseButton: React.FC<{ dataTestId?: string; label: string; onClose: () => void }> = ({
  dataTestId,
  label,
  onClose,
}) => (
  <IconButton
    data-testid={testIdFor(dataTestId, 'close')}
    aria-label={label}
    color="inherit"
    size="small"
    onClick={onClose}
    sx={(theme) => ({
      transition,
      opacity: CLOSE_BUTTON.opacity,
      '&:hover': {
        transform: `rotate(${CLOSE_BUTTON.hoverRotateDeg}deg) scale(${CLOSE_BUTTON.hoverScale})`,
        opacity: 1,
        backgroundColor: alpha(theme.palette.action.hover, CLOSE_BUTTON.washAlpha),
      },
      '&:focus': {
        opacity: 1,
        outline: 'none',
        backgroundColor: alpha(theme.palette.action.focus, CLOSE_BUTTON.washAlpha),
      },
    })}
  >
    <Close fontSize="inherit" />
  </IconButton>
);

/**
 * The dismiss button, or nothing.
 *
 * Reads `closeLabel` straight off the props rather than through the
 * `definedProps` merge, which would widen it to `string | undefined` and hand
 * the button an empty name. The UNION in `AlertProps` guarantees the label
 * wherever `closable` is true — that narrowing is gone inside the component,
 * which is why the fallback below exists and why it is unreachable.
 */
function dismissButton(
  props: AlertProps,
  dataTestId: string | undefined,
  onClose: () => void,
): React.JSX.Element | null {
  if (!props.closable) return null;
  return <AlertCloseButton dataTestId={dataTestId} label={props.closeLabel} onClose={onClose} />;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>((alertProps, ref) => {
  const {
    variant,
    color,
    glow,
    pulse,
    icon,
    showIcon,
    onClose,
    title,
    description,
    children,
    animate,
    role,
    'aria-atomic': ariaAtomic,
    ...others
  } = resolveAlertProps(alertProps);

  // Every spelling of the test id the shared contract allows, mapped to the
  // one the DOM reads and defaulted to `alert`; the native Alert does the same.
  const dataTestId = resolveTestId(others, 'alert');
  const props = withoutTestIdProps(others);

  // Depends on `variant`, so it cannot live in the static defaults above.
  const ariaLive = alertProps['aria-live'] ?? defaultAriaLive(variant);
  const [open, setOpen] = React.useState(true);
  const [isClosing, setIsClosing] = React.useState(false);

  const handleClose = () => {
    setIsClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      onClose?.();
    }, CLOSE_DELAY_MS);
  };

  const severity = toMuiSeverity(variant);

  const displayIcon = showIcon ? (
    <Box component="span" data-testid={testIdFor(dataTestId, 'icon')}>
      {icon || getVariantIcon(variant)}
    </Box>
  ) : (
    false
  );

  const content = (
    <AlertContent title={title} description={description} dataTestId={dataTestId}>
      {children}
    </AlertContent>
  );

  return (
    <Collapse in={open && !isClosing} timeout={COLLAPSE_MS}>
      <StyledAlert
        ref={ref}
        data-testid={dataTestId}
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
        action={dismissButton(alertProps, dataTestId, handleClose)}
        {...props}
      >
        {content}
      </StyledAlert>
    </Collapse>
  );
});

Alert.displayName = 'Alert';
