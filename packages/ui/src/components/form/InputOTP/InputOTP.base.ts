import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH `InputOTP` RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here on purpose: this file is in BOTH declaration
 * outputs (`dist/types` and `dist/types-native`), and a native consumer has no
 * `@mui/material` to resolve a type import against. See `Button.base.ts`.
 */
export type InputOTPVariant = 'numeric' | 'alphanumeric' | 'masked';

export interface InputOTPBaseProps {
  /**
   * The variant of the OTP input
   */
  variant?: InputOTPVariant;

  /**
   * The color theme of the OTP input
   */
  color?: ColorValue;

  /**
   * The size of the OTP input
   */
  size?: SizeValue;

  /**
   * Number of OTP digits
   */
  length?: number;

  /**
   * Current value
   */
  value?: string;

  /**
   * Called when value changes
   */
  onChange?: (value: string) => void;

  /**
   * Called when OTP is complete
   */
  onComplete?: (value: string) => void;

  /**
   * Whether the input should have glass morphism effect
   */
  glass?: boolean;

  /**
   * Whether the input should have gradient effects
   */
  gradient?: boolean;

  /**
   * Whether to auto-focus first input
   */
  autoFocus?: boolean;

  /**
   * Error state
   */
  error?: boolean;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Test ID for automated testing
   * Container will have this ID, and individual slots will have {dataTestId}-slot-{index}
   */
  dataTestId?: string;
}
