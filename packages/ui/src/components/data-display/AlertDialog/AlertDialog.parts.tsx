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
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem } from '../../../tokens/relative';
import { EN_US_UI_LABELS } from '../../../en-US.labels';

import type { AlertDialogProps } from './AlertDialog.types';

/** The query container the dialog's narrow layout reads: its `.MuiDialog-container`. */
export const ALERT_DIALOG_CONTAINER = 'alert-dialog';

/**
 * Below this width of the space the dialog is given, it lays out for a phone:
 * the icon above the title, the buttons each across the row. 480px covers
 * every phone (320–430) and leaves a tablet's dialog as it was.
 */
export const ALERT_DIALOG_NARROW_BELOW = 480;

/** `@container` for a dialog given less than {@link ALERT_DIALOG_NARROW_BELOW}. Never a media query. */
export function narrowDialog(theme: Theme): string {
  return `@container ${ALERT_DIALOG_CONTAINER} (width < ${rem(theme, ALERT_DIALOG_NARROW_BELOW)})`;
}

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
 * Narrow (a dialog given less than {@link ALERT_DIALOG_NARROW_BELOW}, a
 * phone) a PAIR of buttons always grows (a lone one keeps its width), so a pair that stacks is two buttons each
 * across the row rather than two ragged widths pushed to the right
 * (FUT-3831). The stacked ORDER is the library's rule, the platforms' too
 * (Material's stacked dialog actions, Apple's stacked alert buttons): the
 * primary on top and the dismissive one at the bottom, the slot a thumb
 * reaches first — so on a destructive question the safe tap is the near one,
 * and Cancel is still FIRST in the DOM, the tab order. See
 * `components-guidelines.md`, "Stacked buttons".
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
  // A PAIR only: a lone button (`showCancel={false}`) keeps its own width.
  [narrowDialog(theme)]: { '& > .MuiButton-root:not(:only-child)': { flexGrow: 1 } },
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
 * Focus the button that owns focus when the dialog opens.
 *
 * `autoFocus` alone only runs when the button first mounts. Under StrictMode
 * the dialog's tree is mounted, torn down and mounted again, the focus trap's
 * cleanup hands focus back to the opener, and the remounted button is never
 * autofocused: focus landed on the dialog's container and Enter did nothing.
 * An effect runs again on that remount, and runs before the trap's own (a
 * child's effect precedes its parent's), so the trap finds focus already inside.
 */
function useFocusOnOpen(target: React.RefObject<HTMLButtonElement | null>): void {
  React.useEffect(() => {
    target.current?.focus();
  }, [target]);
}

/**
 * Action row: the optional cancel button and the (variant-coloured) confirm,
 * with the emphasised one LAST — the primary slot, on the right or, once the
 * row stacks, on top. DOM order is the tab order, so it follows the same rule.
 */
export function AlertDialogFooter({
  variant,
  cancelText = EN_US_UI_LABELS.alertDialog.cancel,
  confirmText = EN_US_UI_LABELS.alertDialog.confirm,
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
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  useFocusOnOpen(cancelFocused ? cancelRef : confirmRef);
  const cancel = showCancel && (
    <Button
      key="cancel"
      ref={cancelRef}
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
      ref={confirmRef}
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
