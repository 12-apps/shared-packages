import type { SizeValue } from '../../../tokens/scales';
import type { SelectProps as MuiSelectProps } from '@mui/material/Select';

export type SelectVariant = 'default' | 'glass' | 'gradient';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

// `size` is omitted alongside `variant`: MUI declares it in its own words
// (`small | medium`), and this component speaks the house scale.
export interface SelectProps extends Omit<MuiSelectProps, 'variant' | 'size'> {
  /**
   * Visual variant of the select component
   * @default 'default'
   */
  variant?: SelectVariant;
  /**
   * Array of options to display in the select
   */
  options: SelectOption[];
  /**
   * Label for the select field
   */
  label?: string;
  /**
   * Helper text to display below the select
   */
  helperText?: string;
  /**
   * Whether the select should take full width
   * @default true
   */
  fullWidth?: boolean;
  /**
   * Size of the select component
   * @default 'medium'
   */
  size?: SizeValue;
  /**
   * Placeholder text when no option is selected
   */
  placeholder?: string;
  /**
   * Whether to show a glow effect
   * @default false
   */
  glow?: boolean;
  /**
   * Whether to show a pulse animation
   * @default false
   */
  pulse?: boolean;
  /**
   * Test ID for testing purposes
   */
  'data-testid'?: string;
}
