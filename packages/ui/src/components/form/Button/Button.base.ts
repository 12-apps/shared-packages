import type * as React from 'react';

import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * This file imports no MUI and no react-native, on purpose: it is in BOTH
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against.
 */
export type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'text' | 'glass' | 'gradient';

/**
 * The contract both renderers honour. Handlers are NOT here: their names are
 * the same on both sides (`onClick`, `onFocus`, `onBlur`) but their event types
 * are the renderer's own, so each side declares them beside its own extras.
 */
export interface ButtonBaseProps {
  /**
   * The variant of the button
   */
  variant?: ButtonVariant;

  /**
   * The color of the button
   */
  color?: ColorValue;

  /**
   * The size of the button
   */
  size?: SizeValue;

  /**
   * Whether the button is in loading state
   */
  loading?: boolean;

  /**
   * Icon to display in the button
   */
  icon?: React.ReactNode;

  /**
   * Position of the icon
   */
  iconPosition?: 'left' | 'right';

  /**
   * Whether the button should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the button should have a pulse animation
   */
  pulse?: boolean;

  /**
   * Whether to show ripple effect on click
   */
  ripple?: boolean;

  /**
   * Whether the button is in active state
   */
  active?: boolean;

  disabled?: boolean;

  children?: React.ReactNode;

  /**
   * Test ID for testing purposes
   */
  dataTestId?: string;

  testID?: string;
}
