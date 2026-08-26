import Close from '@mui/icons-material/Close';
import Error from '@mui/icons-material/Error';
import Info from '@mui/icons-material/Info';
import type { ButtonProps } from '@mui/material/Button/index.js';
import Button from '@mui/material/Button/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Dialog from '@mui/material/Dialog/index.js';
import DialogActions from '@mui/material/DialogActions/index.js';
import DialogContent from '@mui/material/DialogContent/index.js';
import DialogContentText from '@mui/material/DialogContentText/index.js';
import DialogTitle from '@mui/material/DialogTitle/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, keyframes, styled } from '@mui/material/styles/index.js';
import React from 'react';

import type { AlertDialogProps } from './AlertDialog.types';

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 15px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

const StyledDialog = styled(Dialog, {
  shouldForwardProp: (prop) => 
    !['customVariant', 'glow', 'pulse'].includes(prop as string),
})<{ 
  customVariant?: string; 
  glow?: boolean; 
  pulse?: boolean; 
}>(({ theme, customVariant, glow, pulse }) => ({
  '& .MuiDialog-paper': {
    borderRadius: theme.spacing(2),
    transition: 'all 0.3s ease',
    position: 'relative',
    overflow: 'hidden',

    // Variant styles
    ...(customVariant === 'default' && {
      backgroundColor: theme.palette.background.paper,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),

    // The error tint is LAYERED over the paper, not used as the background
    // itself: `alpha(error, 0.05)` alone leaves the panel 95% transparent, so
    // the page behind it showed straight through the question and its buttons.
    // A confirm nobody can read is the one dialog that must never be hard to
    // read. Same tint, opaque base.
    ...(customVariant === 'destructive' && {
      backgroundColor: theme.palette.background.paper,
      backgroundImage: `linear-gradient(${alpha(theme.palette.error.main, 0.05)}, ${alpha(
        theme.palette.error.main,
        0.05,
      )})`,
      border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
    }),

    ...(customVariant === 'glass' && {
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),

    // Glow effect
    ...(glow && !pulse && {
      boxShadow: `0 0 30px 10px ${alpha(theme.palette.primary.main, 0.3)} !important`,
      filter: 'brightness(1.05)',
    }),

    // Pulse animation
    ...(pulse && !glow && {
      position: 'relative',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'inherit',
        backgroundColor: theme.palette.primary.main,
        opacity: 0.1,
        animation: `${pulseAnimation} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1,
      },
    }),

    // Both glow and pulse
    ...(glow && pulse && {
      position: 'relative',
      boxShadow: `0 0 30px 10px ${alpha(theme.palette.primary.main, 0.3)} !important`,
      filter: 'brightness(1.05)',
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 'inherit',
        backgroundColor: theme.palette.primary.main,
        opacity: 0.1,
        animation: `${pulseAnimation} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1,
      },
    }),
  },
}));

const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  paddingRight: theme.spacing(6), // Space for close button
  '& .MuiTypography-root': {
    fontWeight: 600,
    fontSize: '1.25rem',
  },
}));

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
  paddingTop: theme.spacing(1),
  paddingBottom: theme.spacing(2),
}));

const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2, 3, 3, 3),
  gap: theme.spacing(1),
}));

const CloseButton = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  right: theme.spacing(1),
  top: theme.spacing(1),
  color: theme.palette.grey[500],
}));

/**
 * Per-variant lookups, hoisted out of the render function. They depend on
 * nothing but their arguments, so keeping them at module scope means they are
 * not rebuilt on every render — and it keeps the component's own branch count
 * inside the repo's complexity budget.
 */
const variantIcon = (
  variant: AlertDialogProps['variant'],
  icon: AlertDialogProps['icon'],
): React.ReactNode => {
  if (icon) return icon;
  return variant === 'destructive' ? <Error color="error" /> : <Info color="primary" />;
};

/**
 * Ids for the two elements that give the dialog its accessible name and
 * description. Derived from the test id so they are stable and unique per
 * dialog without a generated id that would change on every render.
 */
const titleId = (dataTestId: string): string => `${dataTestId}-title`;
const descriptionId = (dataTestId: string): string => `${dataTestId}-description`;

/**
 * `alertdialog`, not `dialog`.
 *
 * This component interrupts what the operator was doing and will not go away
 * until they answer — which is exactly the distinction the two roles draw, and
 * it is what makes a screen reader announce the message itself on open rather
 * than just the dialog's name. MUI hardcodes `role="dialog"` on the paper, so
 * it has to be overridden through the paper slot.
 */
const ALERT_ROLE = 'alertdialog';

/**
 * The paper slot's a11y props: the role, plus the name and description wired to
 * the elements that actually carry them, so the announcement is the QUESTION
 * rather than the word "dialog".
 *
 * Both references are conditional — pointing `aria-labelledby` at an element
 * that was never rendered leaves a dangling id, which screen readers treat as
 * no name at all, i.e. worse than omitting it.
 */
function ariaSlotProps(
  dataTestId: string,
  title: AlertDialogProps['title'],
  description: AlertDialogProps['description'],
): { paper: Record<string, string> } {
  return {
    paper: {
      role: ALERT_ROLE,
      ...(title ? { 'aria-labelledby': titleId(dataTestId) } : {}),
      ...(description ? { 'aria-describedby': descriptionId(dataTestId) } : {}),
    },
  };
}

/** Both variants render a filled confirm; only the colour distinguishes them. */
const CONFIRM_BUTTON_VARIANT: ButtonProps['variant'] = 'contained';
const confirmButtonColor = (variant: AlertDialogProps['variant']): 'error' | 'primary' =>
  variant === 'destructive' ? 'error' : 'primary';

/** Title row: the variant icon (unless explicitly suppressed with `null`) + the title. */
function AlertDialogHeader({
  title,
  icon,
  variant,
  dataTestId,
}: {
  title: AlertDialogProps['title'];
  icon: AlertDialogProps['icon'];
  variant: AlertDialogProps['variant'];
  dataTestId: string;
}): React.ReactElement | null {
  if (!title) return null;
  return (
    <StyledDialogTitle id={titleId(dataTestId)} data-testid={`${dataTestId}-title`}>
      {icon !== null && (
        <span data-testid={`${dataTestId}-icon`}>{variantIcon(variant, icon)}</span>
      )}
      <Typography variant="h6" component="span">
        {title}
      </Typography>
    </StyledDialogTitle>
  );
}

/** Action row: the optional cancel button and the (variant-coloured) confirm. */
function AlertDialogFooter({
  variant,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  showCancel = true,
  loading = false,
  confirmDisabled = false,
  initialFocus = 'confirm',
  onCancel,
  onConfirm,
  dataTestId,
}: Pick<
  AlertDialogProps,
  | 'variant'
  | 'cancelText'
  | 'confirmText'
  | 'showCancel'
  | 'loading'
  | 'confirmDisabled'
  | 'initialFocus'
> & {
  onCancel: () => void;
  onConfirm: () => void;
  dataTestId: string;
}): React.ReactElement {
  return (
    <StyledDialogActions data-testid={`${dataTestId}-actions`}>
      {showCancel && (
        <Button
          onClick={onCancel}
          variant="outlined"
          color="inherit"
          disabled={loading}
          autoFocus={initialFocus === 'cancel'}
          data-testid={`${dataTestId}-cancel-button`}
        >
          {cancelText}
        </Button>
      )}
      <Button
        onClick={onConfirm}
        variant={CONFIRM_BUTTON_VARIANT}
        color={confirmButtonColor(variant)}
        disabled={confirmDisabled || loading}
        startIcon={
          loading ? (
            <CircularProgress
              size={16}
              color="inherit"
              data-testid={`${dataTestId}-loading-spinner`}
            />
          ) : undefined
        }
        autoFocus={initialFocus !== 'cancel'}
        data-testid={`${dataTestId}-confirm-button`}
      >
        {confirmText}
      </Button>
    </StyledDialogActions>
  );
}

export const AlertDialog = React.forwardRef<HTMLDivElement, AlertDialogProps>(
  ({
    variant = 'default',
    glow = false,
    pulse = false,
    title,
    description,
    icon,
    cancelText,
    confirmText,
    onCancel,
    onConfirm,
    showCancel,
    loading,
    confirmDisabled,
    initialFocus,
    children,
    onClose,
    'data-testid': dataTestId = 'alert-dialog',
    ...props
  }, ref) => {
    const handleCancel = () => {
      onCancel?.();
      onClose?.({}, 'backdropClick');
    };

    return (
      <StyledDialog
        ref={ref}
        customVariant={variant}
        glow={glow}
        pulse={pulse}
        onClose={onClose}
        data-testid={dataTestId}
        slotProps={ariaSlotProps(dataTestId, title, description)}
        {...props}
      >
        <CloseButton
          aria-label="close"
          onClick={handleCancel}
          size="small"
          data-testid={`${dataTestId}-close-button`}
        >
          <Close />
        </CloseButton>

        <AlertDialogHeader
          title={title}
          icon={icon}
          variant={variant}
          dataTestId={dataTestId}
        />

        <StyledDialogContent data-testid={`${dataTestId}-content`}>
          {description && (
            <DialogContentText
              id={descriptionId(dataTestId)}
              data-testid={`${dataTestId}-description`}
            >
              {description}
            </DialogContentText>
          )}
          {children}
        </StyledDialogContent>

        <AlertDialogFooter
          variant={variant}
          cancelText={cancelText}
          confirmText={confirmText}
          showCancel={showCancel}
          loading={loading}
          confirmDisabled={confirmDisabled}
          initialFocus={initialFocus}
          onCancel={handleCancel}
          onConfirm={() => onConfirm?.()}
          dataTestId={dataTestId}
        />
      </StyledDialog>
    );
  }
);

AlertDialog.displayName = 'AlertDialog';