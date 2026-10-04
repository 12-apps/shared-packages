/**
 * The AlertDialog's action row, kept apart from the dialog shell so each stays
 * inside the complexity budget: which button is filled, where each one sits,
 * and how the row wraps.
 */
import type { ButtonProps } from '@mui/material/Button/index.js';
import Button from '@mui/material/Button/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import DialogActions from '@mui/material/DialogActions/index.js';
import { styled, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';

import type { AlertDialogProps } from './AlertDialog.types';

/**
 * The action row WRAPS WHOLE BUTTONS; it never breaks a label inside one. A pair
 * that did not fit side by side used to squeeze the longer label onto two
 * lines, so one button stood twice as tall as its neighbour. Now the row breaks
 * instead. `wrap-reverse` puts the LAST button — the primary, whichever
 * `emphasis` picks — on top when it stacks, the same slot it holds on the right
 * when the row fits. A pair that fits is laid out exactly as before: natural
 * widths, pushed to the right.
 *
 * `fill` — set only by `emphasis="cancel"` — lets the buttons grow to share the
 * row, and so to take the full width of their line once it stacks. It is not
 * the default because growing also stretches a pair that fits, which would
 * redraw every existing dialog's footer.
 *
 * Rendered with `disableSpacing`: MUI's own spacing is a left margin on every
 * button after the first, which would indent a button that wrapped onto a line
 * of its own. The gaps below replace it, at the same 16px across.
 */
const StyledDialogActions = styled(DialogActions, {
  shouldForwardProp: (prop) => prop !== 'fill',
})<{ fill: boolean }>(({ theme, fill }) => ({
  padding: theme.spacing(2, 3, 3, 3),
  flexWrap: 'wrap-reverse',
  columnGap: theme.spacing(2),
  rowGap: theme.spacing(1),
  // A 40px tap target, the floor the kit's own Button keeps (FUT-3269): MUI's
  // medium button is 37px, short of it on a phone.
  '& > .MuiButton-root': { minHeight: rem(theme, 40) },
  ...(fill && { '& > .MuiButton-root': { flexGrow: 1, minHeight: rem(theme, 40) } }),
}));

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
  emphasis: AlertDialogProps['emphasis'],
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

/**
 * The emphasis that applies: `cancel` only while the cancel is shown. A hidden
 * cancel with the confirm stepped down would leave a dialog with no primary.
 */
const effectiveEmphasis = (
  emphasis: AlertDialogProps['emphasis'],
  showCancel: boolean,
): NonNullable<AlertDialogProps['emphasis']> =>
  emphasis === 'cancel' && showCancel ? 'cancel' : 'confirm';

/**
 * Whether the cancel owns focus on open: what `initialFocus` says, and when it
 * says nothing, the emphasised button — so Enter on a steered question keeps
 * the work instead of completing the loss.
 */
const focusesCancel = (
  initialFocus: AlertDialogProps['initialFocus'],
  emphasis: NonNullable<AlertDialogProps['emphasis']>,
): boolean => (initialFocus ?? emphasis) === 'cancel';

/** The two buttons in slot order: the emphasised one LAST, the primary slot. */
const inSlotOrder = (
  emphasis: AlertDialogProps['emphasis'],
  cancel: React.ReactNode,
  confirm: React.ReactNode,
): React.ReactNode[] => (emphasis === 'cancel' ? [confirm, cancel] : [cancel, confirm]);

/**
 * Action row: the optional cancel button and the (variant-coloured) confirm,
 * with the emphasised one LAST — the primary slot, on the right or, once the
 * row stacks, on top. DOM order is the tab order, so it follows the same rule.
 */
export function AlertDialogFooter({
  variant,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  showCancel = true,
  loading = false,
  confirmDisabled = false,
  initialFocus,
  emphasis: asked,
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
  const emphasis = effectiveEmphasis(asked, showCancel);
  const look = buttonLooks(emphasis, variant);
  const cancelFocused = focusesCancel(initialFocus, emphasis);
  const cancel = showCancel && (
    <Button
      key="cancel"
      onClick={onCancel}
      variant={look.cancel.variant}
      color={look.cancel.color}
      disabled={loading}
      autoFocus={cancelFocused}
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
      autoFocus={!cancelFocused}
      data-testid={`${dataTestId}-confirm-button`}
    >
      {confirmText}
    </Button>
  );
  return (
    <StyledDialogActions
      disableSpacing
      fill={emphasis === 'cancel'}
      data-testid={`${dataTestId}-actions`}
    >
      {inSlotOrder(emphasis, cancel, confirm)}
    </StyledDialogActions>
  );
}
