import Close from '@mui/icons-material/Close';
import {
  Alert as MuiAlert,
  AlertTitle,
  alpha,
  Box,
  Collapse,
  IconButton } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import {
  alertEmphasisStyles,
  alertVariantStyles,
  fadeInScale,
  getColorFromTheme,
  getVariantIcon,
  iconRotate } from './Alert.styles';
import type { AlertColor } from '@mui/material';
import type { AlertProps } from './Alert.types';

// Define animations
const StyledAlert = styled(MuiAlert, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customColor', 'glow', 'pulse', 'animate'].includes(prop as string) })<{
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

    // ROOM TO READ.
    //
    // MUI's `6px 16px` is sized for one line of text and nothing else. This
    // Alert routinely carries three things stacked — a sentence, a smaller
    // explanation, then a control — and at 6px they touched top and bottom and
    // ran together vertically, so the whole card read as one dense block
    // instead of as a message with parts. The generosity is what makes the
    // structure legible; it is not decoration.
    //
    // Padding stays overridable by an `sx` (a full-bleed strip legitimately
    // wants it tight), because this is a default rather than a rule.
    padding: theme.spacing(1.75, 2),

    // Enhanced base styles
    '.MuiAlert-message': {
      display: 'flex',
      flexDirection: 'column',
      // 0.5 put a title, its explanation and a button 4px apart, which reads as
      // a spacing bug rather than as a group. 1 separates the lines; the extra
      // margin below goes to whatever CONTROL sits at the end, because the gap
      // between prose and a thing you press has to be bigger than the gap
      // between two lines of prose or the button looks like part of the text.
      gap: theme.spacing(1),
      fontSize: '0.95rem',
      lineHeight: 1.5,
      // No padding of its own — the root's is now doing that job, and MUI's
      // default `8px 0` on top of it would double the vertical space.
      padding: 0,
      // A CONTROL ON A TINTED PANEL NEEDS AN EDGE.
      //
      // `ghost` and `text` paint no background and no border — bare labels,
      // which works on white where the surrounding page is obviously not
      // clickable. Inside a coloured Alert it stops working: the label is one
      // more coloured phrase among several, and a "Cancelar" beside two lines
      // of prose reads as part of the prose.
      //
      // Only the BORDER is set, never the background or the colour, and that
      // is what makes it safe to apply to every button rather than just the
      // bare ones: a `solid` keeps its fill and its light label and gains a
      // hairline in the same hue, while a `ghost` gains the whole affordance.
      '.MuiButton-root': {
        marginTop: theme.spacing(0.5),
        border: `1px solid ${alpha(colorPalette.main, 0.45)}` },
    },

    '.MuiAlert-icon': {
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      alignItems: 'center',
      // Clear of the words rather than nearly touching them, and aligned to the
      // FIRST line instead of centred on the whole block — an icon floating
      // halfway down a three-line message points at nothing.
      alignSelf: 'flex-start',
      marginRight: theme.spacing(1.75),
      paddingTop: theme.spacing(0.25),
      animation: animate ? `${iconRotate} 0.6s ease-out` : 'none' },

    // The close button, kept off the text it sits beside.
    '.MuiAlert-action': {
      alignItems: 'flex-start',
      paddingLeft: theme.spacing(2) },

    // Hover effects
    '&:hover': {
      transform: 'translateY(-3px) scale(1.01)',
      boxShadow: `0 8px 20px ${alpha(colorPalette.main, 0.2)}`,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',

      '.MuiAlert-icon': {
        transform: 'scale(1.15) rotate(10deg)' },

      '&::before': {
        opacity: 1 } },

    // Active state
    '&:active': {
      transform: 'translateY(-1px) scale(0.99)',
      transition: 'transform 0.1s ease' },

    // Focus styles for accessibility
    '&:focus-within': {
      outline: `3px solid ${alpha(colorPalette.main, 0.5)}`,
      outlineOffset: '3px',
      boxShadow: `0 0 0 6px ${alpha(colorPalette.main, 0.1)}`,
      transition: 'all 0.2s ease' },

    ...alertVariantStyles(theme, customVariant, colorPalette),
    ...alertEmphasisStyles(colorPalette, Boolean(glow), Boolean(pulse)) };
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
  'data-testid': 'alert' } satisfies Partial<AlertProps>;

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
  gradient: 'info' };

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
          wordBreak: 'break-word' }}
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
          wordBreak: 'break-word' }}
      >
        {description}
      </Box>
    )}
    {children}
  </>
);

const AlertCloseButton: React.FC<{ dataTestId?: string; onClose: () => void }> = ({
  dataTestId,
  onClose }) => (
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
        backgroundColor: alpha(theme.palette.action.hover, 0.1) },
      '&:focus': {
        opacity: 1,
        outline: 'none',
        backgroundColor: alpha(theme.palette.action.focus, 0.1) } })}
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
