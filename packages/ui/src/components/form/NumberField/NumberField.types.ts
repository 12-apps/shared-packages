import type { ReactNode } from 'react';

import type { InputProps } from '../Input/Input.types';

/**
 * What `NumberField` takes over from `Input`: the value and its change are
 * numbers here, not strings, and the element's type, keyboard and trailing
 * slot are the field's own.
 */
type OwnedInputProps =
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'type'
  | 'inputMode'
  | 'pattern'
  | 'min'
  | 'max'
  | 'step'
  | 'endAdornment'
  | 'maxLength';

export interface NumberFieldProps extends Omit<InputProps, OwnedInputProps> {
  /** The value. `null` is an empty field — never `0`, never `NaN`. */
  value: number | null;
  /** Every edit, as the number it now reads, or `null` once cleared. */
  onChange: (value: number | null) => void;
  /**
   * The lowest value ArrowDown reaches, and what a blur raises a smaller one
   * to. Digits only, so the field never holds a negative number whatever this
   * says.
   */
  min?: number;
  /** The highest value ArrowUp reaches, and what a blur lowers a larger one to. */
  max?: number;
  /** How far one ArrowUp / ArrowDown moves the value. Defaults to 1. */
  step?: number;
  /**
   * The unit, drawn INSIDE the field's border at its end — "min", "%", "kg".
   * Also read to screen readers as part of the field's description.
   */
  suffix?: ReactNode;
}
