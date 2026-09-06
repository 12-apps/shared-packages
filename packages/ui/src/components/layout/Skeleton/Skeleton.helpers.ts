import type { SkeletonBaseProps } from './Skeleton.base';

type SkeletonDefaultedKeys =
  | 'variant'
  | 'animation'
  | 'count'
  | 'spacing'
  | 'intensity'
  | 'glassmorphism'
  | 'shimmer';

/**
 * Generic over the renderer's own props: the web and the native `Skeleton`
 * carry different extras (`className`/`style` against a `View`'s props), and
 * both come back out untouched.
 */
type ResolvedSkeletonProps<P extends SkeletonBaseProps> = P &
  Required<Pick<SkeletonBaseProps, SkeletonDefaultedKeys>>;

const SKELETON_DEFAULTS: Required<Pick<SkeletonBaseProps, SkeletonDefaultedKeys>> = {
  variant: 'text',
  animation: 'pulse',
  count: 1,
  spacing: 1,
  intensity: 'medium',
  glassmorphism: false,
  shimmer: false,
};

// Strips explicitly-undefined props before the merge, so `count={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = <P extends SkeletonBaseProps>(props: P): Partial<P> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<P>;

export const resolveSkeletonProps = <P extends SkeletonBaseProps>(
  props: P,
): ResolvedSkeletonProps<P> =>
  ({ ...SKELETON_DEFAULTS, ...definedProps(props) }) as ResolvedSkeletonProps<P>;

/**
 * The id of instance `index` when a caller asked for several. Unnamed
 * skeletons stay unnamed — the web has always cloned `undefined` there.
 */
export const skeletonInstanceTestId = (
  base: string | undefined,
  index: number,
): string | undefined => (base ? `${base}-${index}` : undefined);
