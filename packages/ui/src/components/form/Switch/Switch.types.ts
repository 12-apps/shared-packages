import type { SwitchProps as MuiSwitchProps } from '@mui/material/Switch/index.js';
import type { FocusEventHandler, MouseEventHandler } from 'react';

import type { SwitchBaseProps } from './Switch.base';

export type { SwitchBaseProps, SwitchLabelPosition, SwitchVariant } from './Switch.base';

/**
 * The web `Switch`: the shared contract, plus everything MUI's `Switch`
 * accepts that the contract does not already name — `checked`,
 * `defaultChecked`, `onChange`, `inputProps`, `sx`.
 */
export interface SwitchProps
  extends SwitchBaseProps,
    Omit<MuiSwitchProps, 'color' | 'size' | keyof SwitchBaseProps> {
  /**
   * Click handler
   */
  onClick?: MouseEventHandler<HTMLButtonElement>;

  /**
   * Focus handler
   */
  onFocus?: FocusEventHandler<HTMLButtonElement>;

  /**
   * Blur handler
   */
  onBlur?: FocusEventHandler<HTMLButtonElement>;
}
