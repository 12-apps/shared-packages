import type { DialogProps as MuiDialogProps } from '@mui/material/Dialog/index.js';

import type {
  DialogActionsBaseProps,
  DialogBaseProps,
  DialogContentBaseProps,
  DialogHeaderBaseProps,
} from './Dialog.base';

export type {
  DialogActionsAlignment,
  DialogActionsBaseProps,
  DialogBaseProps,
  DialogBorderRadius,
  DialogContentBaseProps,
  DialogHeaderBaseProps,
  DialogSize,
  DialogVariant,
} from './Dialog.base';

/** The web `Dialog`: the shared contract, plus everything MUI's own `Dialog` takes. */
export interface DialogProps
  extends DialogBaseProps,
    Omit<MuiDialogProps, 'variant' | 'title' | keyof DialogBaseProps> {}

export type DialogHeaderProps = DialogHeaderBaseProps;

export type DialogContentProps = DialogContentBaseProps;

export type DialogActionsProps = DialogActionsBaseProps;
