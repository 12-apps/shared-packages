import type { ReactNode } from 'react';

import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here: this file is in BOTH declaration outputs,
 * and a native consumer has no `@mui/material` to resolve a type import
 * against. See `Button.base.ts`.
 */
export type SwitchVariant = 'default' | 'ios' | 'android' | 'label' | 'material';
export type SwitchLabelPosition = 'start' | 'end' | 'top' | 'bottom';

/**
 * The contract both renderers honour.
 *
 * `checked`, `defaultChecked` and `onChange` are NOT here: MUI types the
 * change as a DOM `ChangeEvent` and the native side synthesises the
 * `{ target: { checked } }` shape those handlers already read.
 */
export interface SwitchBaseProps {
  /**
   * The variant of the switch
   */
  variant?: SwitchVariant;

  /**
   * The color theme of the switch
   */
  color?: ColorValue;

  /**
   * The size of the switch
   */
  size?: SizeValue;

  /**
   * Label text for the switch
   */
  label?: string;

  /**
   * Description text below the label
   */
  description?: string;

  /**
   * Whether the switch should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the switch should have glass morphism effect
   */
  glass?: boolean;

  /**
   * Whether the switch should have gradient effects
   */
  gradient?: boolean;

  /**
   * Position of the label relative to the switch
   */
  labelPosition?: SwitchLabelPosition;

  /**
   * Icon to show when switch is on
   */
  onIcon?: ReactNode;

  /**
   * Icon to show when switch is off
   */
  offIcon?: ReactNode;

  /**
   * Text to show when switch is on
   */
  onText?: string;

  /**
   * Text to show when switch is off
   */
  offText?: string;

  /**
   * Whether the switch has an error state
   */
  error?: boolean;

  /**
   * Help text to display
   */
  helperText?: string;

  /**
   * Custom width for the switch track
   */
  trackWidth?: number;

  /**
   * Custom height for the switch track
   */
  trackHeight?: number;

  /**
   * Whether to enable animations
   */
  animated?: boolean;

  /**
   * Whether the switch is in loading state
   */
  loading?: boolean;

  /**
   * Whether to show ripple effect
   */
  ripple?: boolean;

  /**
   * Whether the switch should have pulse animation
   */
  pulse?: boolean;

  disabled?: boolean;

  testID?: string;

  /**
   * Custom test ID for testing
   */
  dataTestId?: string;
}
