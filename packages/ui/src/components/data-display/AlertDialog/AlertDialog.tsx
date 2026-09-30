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
import { alpha, keyframes, styled, useTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { neutralTones } from '../../../tokens/ink';

import type { AlertDialogProps } from './AlertDialog.types';
import { rem, rems } from '../../../tokens/relative';

// Define pulse animation
const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 15)} currentColor;
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
      backdropFilter: `blur(${rem(theme, 20)})`,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),

    // Glow effect
    ...(glow && !pulse && {
      boxShadow: `0 0 ${rems(theme, 30, 10)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
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
        animation: `${pulseAnimation(theme)} 2s infinite`,
        pointerEvents: 'none',
        zIndex: -1,
      },
    }),

    // Both glow and pulse
    ...(glow && pulse && {
      position: 'relative',
      boxShadow: `0 0 ${rems(theme, 30, 10)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
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
        animation: `${pulseAnimation(theme)} 2s infinite`,
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
    fontSize: rem(theme, 20),
  },
}));

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
  paddingTop: theme.spacing(1),
  paddingBottom: theme.spacing(2),
}));

/**
 * The action row WRAPS WHOLE BUTTONS; it never breaks a label inside one. A pair
 * that did not fit side by side used to squeeze the longer label onto two
 * lines, so one button stood twice as tall as its neighbour. Now the row breaks
 * instead and each button takes the full width of its line. `wrap-reverse` puts
 * the LAST button — the primary, whichever `emphasis` picks — on top when it
 * stacks, the same slot it holds on the right when the row fits.
 *
 * Rendered with `disableSpacing`: MUI's own spacing is a left margin on every
 * button after the first, which would indent a button that wrapped onto a line
 * of its own. The gaps below replace it, at the same 16px across.
 */
const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2, 3, 3, 3),
  flexWrap: 'wrap-reverse',
  columnGap: theme.spacing(2),
  rowGap: theme.spacing(1),
  '& > .MuiButton-root': {
    flex: '1 1 auto',
  },
}));

const CloseButton = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  right: theme.spacing(1),
  top: theme.spacing(1),
  color: neutralTones(theme).muted,
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

const confirmButtonColor = (variant: AlertDialogProps['variant']): 'error' | 'primary' =>
  variant === 'destructive' ? 'error' : 'primary';

interface ButtonLook {
  variant: ButtonProps['variant'];
  color: ButtonProps['color'];
}

/**
 * How each button is drawn, by `emphasis`: the emphasised one is filled, the
 * other a NEUTRAL outline. Primary / neutral both ways round — a confirm that
 * steps down drops the variant's colour too, so the one filled button is the
 * only coloured thing in the row and the eye has a single place to land.
 */
const buttonLooks = (
  emphasis: NonNullable<AlertDialogProps['emphasis']>,
  variant: AlertDialogProps['variant'],
): { cancel: ButtonLook; confirm: ButtonLook } =>
  emphasis === 'cancel'
    ? {
        cancel: { variant: 'contained', color: 'primary' },
        confirm: { variant: 'outlined', color: 'inherit' },
      }
    : {
        cancel: { variant: 'outlined', color: 'inherit' },
        confirm: { variant: 'contained', color: confirmButtonColor(variant) },
      };

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

/**
 * Action row: the optional cancel button and the (variant-coloured) confirm,
 * with the emphasised one LAST — the primary slot, on the right or, once the
 * row stacks, on top. DOM order is the tab order, so it follows the same rule.
 */
function AlertDialogFooter({
  variant,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  showCancel = true,
  loading = false,
  confirmDisabled = false,
  initialFocus = 'confirm',
  emphasis = 'confirm',
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
  | 'emphasis'
> & {
  onCancel: () => void;
  onConfirm: () => void;
  dataTestId: string;
}): React.ReactElement {
  const theme = useTheme();
  const look = buttonLooks(emphasis, variant);
  const cancel = showCancel && (
    <Button
      key="cancel"
      onClick={onCancel}
      variant={look.cancel.variant}
      color={look.cancel.color}
      disabled={loading}
      autoFocus={initialFocus === 'cancel'}
      data-testid={`${dataTestId}-cancel-button`}
    >
      {cancelText}
    </Button>
  );
  const confirm = (
    <Button
      key="confirm"
      onClick={onConfirm}
      variant={look.confirm.variant}
      color={look.confirm.color}
      disabled={confirmDisabled || loading}
      startIcon={
        loading ? (
          <CircularProgress
            size={rem(theme, 16)}
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
  );
  return (
    <StyledDialogActions disableSpacing data-testid={`${dataTestId}-actions`}>
      {emphasis === 'cancel' ? [confirm, cancel] : [cancel, confirm]}
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
    emphasis,
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
          emphasis={emphasis}
          onCancel={handleCancel}
          onConfirm={() => onConfirm?.()}
          dataTestId={dataTestId}
        />
      </StyledDialog>
    );
  }
);

AlertDialog.displayName = 'AlertDialog';