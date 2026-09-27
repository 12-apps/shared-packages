/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here: this file is in BOTH declaration outputs,
 * and a native consumer has no `@mui/material` to resolve a type import
 * against. See `Button.base.ts`.
 */
import type { SizeValue } from '../../../tokens/vocabulary';

export type CheckboxVariant = 'default' | 'rounded' | 'toggle';

/**
 * MUI's own words for the glyph's size — `CHECKBOX_GLYPH_SIZES` in
 * `Checkbox.metrics.ts` gives each one's pixel value.
 *
 * @deprecated `size` now also accepts `SizeValue` (`'xs' | 'sm' | 'md' | 'lg' |
 * 'xl'`), the house vocabulary every other sized component in the package
 * speaks — translated to this at the MUI boundary by `resolveCheckboxSize`
 * (`Checkbox.metrics.ts`). These words keep working for one release; pass
 * `SizeValue` instead. Removed in the next major version.
 */
export type CheckboxSize = 'small' | 'medium' | 'large';

/**
 * The contract both renderers honour.
 *
 * `checked`, `defaultChecked` and `onChange` are NOT here: MUI types the change
 * as a DOM `ChangeEvent` and the native side synthesises the
 * `{ target: { checked } }` shape those handlers already read.
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
  /**
   * The size of the box and glyph.
   *
   * `SizeValue` (`'xs' | 'sm' | 'md' | 'lg' | 'xl'`) is the documented house
   * vocabulary every other sized component in the package speaks, translated
   * to MUI's own word at the MUI boundary (`resolveCheckboxSize`, in
   * `Checkbox.metrics.ts`) — the same pattern `Chip`/`Button` already follow.
   * MUI's own words (`CheckboxSize`) still work; see its `@deprecated` note.
   */
  size?: SizeValue | CheckboxSize;
  testID?: string;
  dataTestId?: string;
}
