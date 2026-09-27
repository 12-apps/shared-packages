import type { CheckboxProps as MuiCheckboxProps } from '@mui/material/Checkbox/index.js';
import type { ChangeEvent, FocusEventHandler, MouseEventHandler } from 'react';

import type { CheckboxBaseProps } from './Checkbox.base';

export type { CheckboxBaseProps, CheckboxSize, CheckboxVariant } from './Checkbox.base';

/**
 * The web `Checkbox`: the shared contract, plus everything MUI's `Checkbox`
 * accepts that the contract does not already name — `checked`,
 * `defaultChecked`, `color`, `icon`, `inputProps`, `sx`. `size` IS already
 * named by the contract (`CheckboxBaseProps`), which is why it is omitted
 * from what flows through here — MUI's own `size` type would otherwise win
 * over the house `SizeValue` the contract adds.
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
