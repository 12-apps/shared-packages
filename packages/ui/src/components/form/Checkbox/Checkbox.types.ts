import type { CheckboxProps as MuiCheckboxProps } from '@mui/material/Checkbox/index.js';
import type { ChangeEvent, FocusEventHandler, MouseEventHandler } from 'react';

import type { CheckboxBaseProps } from './Checkbox.base';

export type { CheckboxBaseProps, CheckboxVariant } from './Checkbox.base';

/**
 * The web `Checkbox`: the shared contract, plus everything MUI's `Checkbox`
 * accepts that the contract does not already name — `checked`,
 * `defaultChecked`, `size`, `color`, `icon`, `inputProps`, `sx`.
 */
export interface CheckboxProps
  extends CheckboxBaseProps,
    Omit<MuiCheckboxProps, 'variant' | keyof CheckboxBaseProps> {
  'data-testid'?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  onChange?: (event: ChangeEvent<HTMLElement>, checked: boolean) => void;
}
