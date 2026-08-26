import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { LinearProgressProps } from '@mui/material/LinearProgress/index.js';

export type ProgressVariant = 'linear' | 'circular' | 'segmented' | 'gradient' | 'glass';
export type ProgressSize = SizeValue;

export interface ProgressProps extends Omit<LinearProgressProps, 'variant' | 'color'> {
  /**
   * The variant of the progress
   */
  variant?: ProgressVariant;

  /**
   * The size of the progress
   */
  size?: ProgressSize;

  /**
   * The color of the progress
   */
  color?: ColorValue;

  /**
   * Whether the progress should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the progress should have a pulse animation
   */
  pulse?: boolean;

  /**
   * Show percentage text
   */
  showLabel?: boolean;

  /**
   * Custom label text
   */
  label?: string;

  /**
   * Number of segments for segmented variant
   */
  segments?: number;

  /**
   * Thickness for circular variant
   */
  thickness?: number;

  /**
   * Size for circular variant
   */
  circularSize?: number;

  /**
   * Test ID for testing purposes
   */
  dataTestId?: string;
}