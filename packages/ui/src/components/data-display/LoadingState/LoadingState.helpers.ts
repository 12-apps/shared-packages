import type { LoadingStateProps, LoadingStateSize } from './LoadingState.types';

export const SIZE_MAP: Record<
  LoadingStateSize,
  { spinner: number; text: 'body2' | 'body1' | 'h6' }
> = {
  sm: { spinner: 24, text: 'body2' },
  md: { spinner: 40, text: 'body1' },
  lg: { spinner: 56, text: 'h6' },
};

export const SKELETON_ROW_HEIGHT: Record<LoadingStateSize, number> = {
  sm: 20,
  md: 28,
  lg: 36,
};

type LoadingStateDefaultedKeys = 'variant' | 'size' | 'skeletonRows';

type ResolvedLoadingStateProps = LoadingStateProps &
  Required<Pick<LoadingStateProps, LoadingStateDefaultedKeys>>;

const LOADING_STATE_DEFAULTS: Pick<LoadingStateProps, LoadingStateDefaultedKeys> = {
  variant: 'spinner',
  size: 'md',
  skeletonRows: 3,
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: LoadingStateProps): Partial<LoadingStateProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<LoadingStateProps>;

export const resolveLoadingStateProps = (
  props: LoadingStateProps,
): ResolvedLoadingStateProps =>
  ({ ...LOADING_STATE_DEFAULTS, ...definedProps(props) }) as ResolvedLoadingStateProps;

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
