import type { SizeValue } from '../../../tokens/scales';
import type { InputLabelProps as MuiInputLabelProps } from '@mui/material';
import type { InputHTMLAttributes, ReactNode } from 'react';
import type React from 'react';

export type InputVariant = 'outlined' | 'filled' | 'glass' | 'underline' | 'gradient';
export type InputSize = Extract<SizeValue, 'sm' | 'md' | 'lg'>;

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'color'> {
  variant?: InputVariant;
  size?: InputSize;
  label?: string;
  error?: boolean;
  helperText?: string;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  fullWidth?: boolean;
  floating?: boolean;
  glow?: boolean;
  pulse?: boolean;
  loading?: boolean;
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
