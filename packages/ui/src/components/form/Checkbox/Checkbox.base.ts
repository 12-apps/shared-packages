/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here: this file is in BOTH declaration outputs,
 * and a native consumer has no `@mui/material` to resolve a type import
 * against. See `Button.base.ts`.
 */
export type CheckboxVariant = 'default' | 'rounded' | 'toggle';

/**
 * The contract both renderers honour.
 *
 * `checked`, `defaultChecked` and `onChange` are NOT here: MUI types the change
 * as a DOM `ChangeEvent` and the native side synthesises the
 * `{ target: { checked } }` shape those handlers already read. Neither is
 * `size`, which this component takes in MUI's own words (`small | medium`)
 * rather than the house scale — narrowing it would reject the callers it has.
 */
export interface CheckboxBaseProps {
  variant?: CheckboxVariant;
  label?: string;
  /** Paints the label and the helper text in the danger hue. */
  error?: boolean;
  helperText?: string;
  /** Fades the box, makes it inert and turns a spinner over it. */
  loading?: boolean;
  /** The touch ripple. `false` removes it. */
  ripple?: boolean;
  glow?: boolean;
  pulse?: boolean;
  /** The third state: neither checked nor unchecked, drawn as a dash. */
  indeterminate?: boolean;
  disabled?: boolean;
  testID?: string;
  dataTestId?: string;
}
