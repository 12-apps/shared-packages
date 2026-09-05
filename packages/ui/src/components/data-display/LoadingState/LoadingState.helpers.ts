import type { LoadingStateBaseProps, LoadingStateSize } from './LoadingState.base';
import { MESSAGE_TYPE, SKELETON_ROW_HEIGHT, SPINNER_SIZES } from './LoadingState.metrics';
import type { MuiTypeVariantName } from '../../../tokens/mui-type';
import { SIZE_VALUES } from '../../../tokens/vocabulary';

export { SKELETON_ROW_HEIGHT };

// Derived from the shared metrics, not restated: the native `LoadingState`
// reads the same two tables, so the renderers cannot disagree on a size.
export const SIZE_MAP: Record<LoadingStateSize, { spinner: number; text: MuiTypeVariantName }> =
  Object.fromEntries(
    SIZE_VALUES.map((size) => [size, { spinner: SPINNER_SIZES[size], text: MESSAGE_TYPE[size] }]),
  ) as Record<LoadingStateSize, { spinner: number; text: MuiTypeVariantName }>;

type LoadingStateDefaultedKeys = 'variant' | 'size' | 'skeletonRows';

/**
 * Generic over the renderer's own props: the web and the native `LoadingState`
 * pass different extras through, and both come back out untouched.
 */
type ResolvedLoadingStateProps<P extends LoadingStateBaseProps> = P &
  Required<Pick<LoadingStateBaseProps, LoadingStateDefaultedKeys>>;

const LOADING_STATE_DEFAULTS: Required<Pick<LoadingStateBaseProps, LoadingStateDefaultedKeys>> = {
  variant: 'spinner',
  size: 'md',
  skeletonRows: 3,
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = <P extends LoadingStateBaseProps>(props: P): Partial<P> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<P>;

export const resolveLoadingStateProps = <P extends LoadingStateBaseProps>(
  props: P,
): ResolvedLoadingStateProps<P> =>
  ({ ...LOADING_STATE_DEFAULTS, ...definedProps(props) }) as ResolvedLoadingStateProps<P>;

/**
 * Test ids come in three flavours here: the container falls back to a bare
 * `loading-state`, the labelled parts to `loading-state-<part>`, and the
 * skeleton rows to nothing at all when the caller supplied no base id.
 */
export const makeTestIds = (dataTestId?: string) => ({
  base: dataTestId || 'loading-state',
  optional: (suffix: string): string | undefined =>
    dataTestId ? `${dataTestId}-${suffix}` : undefined,
  named: (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `loading-state-${suffix}`,
});

export type LoadingStateTestIds = ReturnType<typeof makeTestIds>;
