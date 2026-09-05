import type { AlertProps as MuiAlertProps } from '@mui/material/Alert/index.js';

import type { AlertBaseFields, AlertDismiss } from './Alert.base';

export type { AlertBaseFields, AlertBaseProps, AlertDismiss, AlertVariant } from './Alert.base';

/** The web `Alert`'s non-dismiss half: the shared fields, plus MUI's `Alert` props where they do not overlap. */
export interface AlertBase
  extends AlertBaseFields,
    Omit<MuiAlertProps, 'variant' | 'color' | 'role' | keyof AlertBaseFields> {}

export type AlertProps = AlertBase & AlertDismiss;
