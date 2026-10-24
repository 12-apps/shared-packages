import type { LoadingStateLabels } from '../../../copy/labels';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * Imports no MUI and no react-native, on purpose: it ships in both
 * declaration outputs. The web adds `className`; the native side adds a
 * `View`'s own props in `LoadingState.types.native.ts`.
 */
export type LoadingStateVariant = 'spinner' | 'skeleton';
export type LoadingStateSize = SizeValue;

export interface LoadingStateBaseProps {
  /**
   * The visual style of the loading indicator
   * @default 'spinner'
   */
  variant?: LoadingStateVariant;

  /**
   * Optional message to display below the loading indicator
   */
  message?: string;

  /**
   * The accessible name while no `message` is given, per variant. Optional: a
   * host that names nothing hears "Loading content" / "Loading", as it always
   * did; a pt-BR host passes `UI_LABELS['pt-BR'].loadingState`.
   */
  labels?: Partial<LoadingStateLabels>;

  /**
   * Size of the loading indicator
   * @default 'md'
   */
  size?: LoadingStateSize;

  /**
   * Number of skeleton rows to display (only for skeleton variant)
   * @default 3
   */
  skeletonRows?: number;

  /**
   * Test ID for component testing
   */
  dataTestId?: string;

  testID?: string;
}
