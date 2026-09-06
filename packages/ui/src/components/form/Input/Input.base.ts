import type { HTMLInputTypeAttribute, ReactNode } from 'react';

import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here on purpose: this file is in BOTH declaration
 * outputs (`dist/types` and `dist/types-native`), and a native consumer has no
 * `@mui/material` to resolve a type import against. See `Button.base.ts`.
 */
export type InputVariant = 'outlined' | 'filled' | 'glass' | 'underline' | 'gradient';
export type InputSize = SizeValue;

/**
 * The contract both renderers honour.
 *
 * `value`, `defaultValue` and the handlers are NOT here. Their NAMES are the
 * same on both sides, but a web `value` is `string | number | readonly
 * string[]` and a native one is a `string`, so each side inherits its own from
 * the element it wraps — the same rule `Button.base.ts` applies to `onClick`.
 *
 * `type` keeps the full `HTMLInputTypeAttribute` union rather than the seven
 * kinds a native field can honour: narrowing it would reject the `type="date"`
 * and `type="time"` call sites the web already has (FUT-729). A native `Input`
 * maps `text`, `search`, `email`, `tel`, `url`, `number` and `password` onto
 * the keyboard and secure-entry props and treats every other type as text.
 */
export interface InputBaseProps {
  /** The visual variant of the field. */
  variant?: InputVariant;

  /** A step of the house size scale. */
  size?: InputSize;

  /** What the field collects; on native it picks the keyboard and secure entry. */
  type?: HTMLInputTypeAttribute;

  /** The label above (native) or inside (web) the field. */
  label?: string;

  placeholder?: string;

  /** Paints the field, the label and the helper text in the danger hue. */
  error?: boolean;

  /** The line under the field: the error message, or a hint. */
  helperText?: string;

  /** Content before the value — an icon, a currency symbol. */
  startAdornment?: ReactNode;

  /** Content after the value. Replaced by the spinner while `loading`. */
  endAdornment?: ReactNode;

  /** Stretch to the width of the parent. Defaults to true, as MUI's does not. */
  fullWidth?: boolean;

  /** The label animates into the border rather than sitting over the field. */
  floating?: boolean;

  /** A halo of the primary hue around the field, stronger while focused. */
  glow?: boolean;

  /** A bar behind the field that pulses outward every two seconds. */
  pulse?: boolean;

  /** Fades the field, makes it inert and puts a spinner where the end adornment goes. */
  loading?: boolean;

  disabled?: boolean;

  readOnly?: boolean;

  required?: boolean;

  autoFocus?: boolean;

  maxLength?: number;

  testID?: string;

  dataTestId?: string;
}
