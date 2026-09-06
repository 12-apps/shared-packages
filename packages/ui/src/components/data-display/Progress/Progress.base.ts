import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * This file imports no MUI and no react-native, on purpose: it is in BOTH
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against.
 */
export type ProgressVariant = 'linear' | 'circular' | 'segmented' | 'gradient' | 'glass';
export type ProgressSize = SizeValue;

export interface ProgressBaseProps {
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
   * How far along, 0 to 100. Absent means INDETERMINATE — the bar animates
   * rather than reporting progress.
   */
  value?: number;

  /**
   * Test ID for testing purposes. Names the component: the wrapper takes it,
   * and the bar, the segments and the label derive theirs from it.
   */
  dataTestId?: string;

  /** React Native's spelling of {@link ProgressBaseProps.dataTestId}. */
  testID?: string;

  /**
   * NOT the component's id. It is an attribute the caller is putting on the
   * ELEMENT the progress draws — the bar for a linear or circular progress,
   * the wrapper for a segmented one — which is where it has always landed on
   * the web, along with every other unrecognised prop.
   */
  'data-testid'?: string;
}
