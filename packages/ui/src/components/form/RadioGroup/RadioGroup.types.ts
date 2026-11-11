import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { RadioGroupProps as MuiRadioGroupProps } from '@mui/material/RadioGroup/index.js';
import type React from 'react';

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** The card's own test id (`cards` variant), in place of the index-based `<dataTestId>-card-<n>`. */
  dataTestId?: string;
}

export interface RadioGroupProps extends Omit<MuiRadioGroupProps, 'color'> {
  /**
   * The variant of the radio group
   */
  variant?: 'default' | 'cards' | 'buttons' | 'segments';

  /**
   * The color theme of the radio group
   */
  color?: ColorValue;

  /**
   * The size of the radio group
   */
  size?: SizeValue;

  /**
   * Array of radio options
   */
  options: RadioOption[];

  /**
   * Label for the radio group
   */
  label?: string;

  /**
   * Whether the radio group has an error
   */
  error?: boolean;

  /**
   * Help text to display below the radio group
   */
  helperText?: string;

  /**
   * Whether the label should have a glass effect
   */
  glassLabel?: boolean;

  /**
   * Whether the radio group should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the radio group should have glass morphism effect
   */
  glass?: boolean;

  /**
   * Whether the radio group should have gradient effects
   */
  gradient?: boolean;

  /**
   * Layout direction for the radio options
   */
  direction?: 'row' | 'column';

  /**
   * Whether to show descriptions for card variant
   */
  showDescriptions?: boolean;

  /**
   * `variant="cards"`: a visible radio in each card, before its label. The card
   * itself is the `radio` (keyboard and screen reader); this is the mark.
   */
  indicator?: boolean;

  /**
   * Test ID for the radio group container element
   */
  dataTestId?: string;
}
