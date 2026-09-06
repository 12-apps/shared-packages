import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here: this file is in BOTH declaration outputs,
 * and a native consumer has no `@mui/material` to resolve a type import
 * against. See `Button.base.ts`.
 */
export type SelectVariant = 'default' | 'glass' | 'gradient';

/** What a value can be. The DOM stringifies either, so the two are compared as strings. */
export type SelectValue = string | number;

export interface SelectOption {
  value: SelectValue;
  label: string;
  disabled?: boolean;
}

/**
 * The contract both renderers honour.
 *
 * `value`, `defaultValue` and `onChange` are NOT here: MUI types the value as
 * `unknown` and the change as its own `SelectChangeEvent`, while the native
 * side takes a `SelectValue` and synthesises the `{ target: { value } }` shape
 * the web handlers already read.
 */
export interface SelectBaseProps {
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
   * Paints the field, the label and the helper text in the danger hue
   */
  error?: boolean;
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
  disabled?: boolean;
  testID?: string;
  dataTestId?: string;
}
