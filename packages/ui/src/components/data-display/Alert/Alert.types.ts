import type { AlertProps as MuiAlertProps } from '@mui/material/Alert/index.js';

import type { AlertBaseFields, AlertDismiss } from './Alert.base';
import type { AlertIconPlacement } from './Alert.placement';

export type { AlertBaseFields, AlertBaseProps, AlertDismiss, AlertVariant } from './Alert.base';
export type { AlertIconPlacement, UiAlertTheme } from './Alert.placement';

/** The web `Alert`'s non-dismiss half: the shared fields, plus MUI's `Alert` props where they do not overlap. */
export interface AlertBase
  extends AlertBaseFields,
    Omit<MuiAlertProps, 'variant' | 'color' | 'role' | keyof AlertBaseFields> {
  /**
   * Where the icon sits: its own column (`'gutter'`) or on the title's line
   * (`'title'`). Unset, the theme's `uiAlert.iconPlacement` decides, else
   * `'gutter'`. Web only. See `Alert.placement.ts`.
   */
  iconPlacement?: AlertIconPlacement;
}

export type AlertProps = AlertBase & AlertDismiss;
