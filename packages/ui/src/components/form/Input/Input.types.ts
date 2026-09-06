import type { InputLabelProps as MuiInputLabelProps } from '@mui/material/InputLabel/index.js';
import type { InputHTMLAttributes } from 'react';
import type React from 'react';

import type { InputBaseProps } from './Input.base';

export type { InputBaseProps, InputSize, InputVariant } from './Input.base';

/**
 * The web `Input`: the shared contract, plus everything an `<input>` accepts
 * that the contract does not already name.
 *
 * `value`, `defaultValue` and `onChange` keep the DOM's own types — they are
 * not in the base, because a web `value` is `string | number | readonly
 * string[]` and a React Native one is a `string`.
 */
export interface InputProps
  extends InputBaseProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'color' | keyof InputBaseProps> {
  onClick?: React.MouseEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  'data-testid'?: string;
  /**
   * Props for the floating label. The one that matters is `shrink`: a native
   * `type="date"` (or `time`) input always paints its own `dd/mm/aaaa` hint,
   * empty or not, while the label only floats once the field is focused or
   * filled — so at rest the two overlap and neither reads. `shrink: true`
   * pins the label up. Callers already passed this and it already worked
   * (the component spreads the rest of its props onto the TextField); only
   * the TYPE was missing, so it failed to compile. FUT-729.
   */
  InputLabelProps?: Partial<MuiInputLabelProps>;
}
