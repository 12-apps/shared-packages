import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR (see `Button.base.ts`).
 *
 * No MUI and no react-native here: this file ships in both declaration
 * outputs, and a native consumer has no `@mui/material` to resolve against.
 */

export interface InputOTPBaseProps {
  /**
   * The variant of the OTP input
   */
  variant?: 'numeric' | 'alphanumeric' | 'masked';
  
  /**
   * The color theme of the OTP input
   */
  color?: ColorValue;
  
  /**
   * The size of the OTP input
   */
  size?: SizeValue;
  
  /**
   * How the boxes take the row's width (FUT-4585).
   *
   * Left out, each box is a square of the size's field height, and the row is
   * as wide as its boxes — what every caller drew before this option.
   *
   * `'width'`: the row takes its parent's whole width and the boxes share it
   * with a 6px gap. Each keeps the size's field height (never under 40) and
   * its type, and narrows to fit: never wider than it is tall, never under
   * 32. On a narrow phone that draws PORTRAIT boxes instead of a smaller size.
   */
  fit?: 'width';

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