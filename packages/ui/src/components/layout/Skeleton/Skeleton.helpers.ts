import type { SkeletonProps } from './Skeleton.types';

type SkeletonDefaultedKeys =
  | 'variant'
  | 'animation'
  | 'count'
  | 'spacing'
  | 'intensity'
  | 'glassmorphism'
  | 'shimmer';

type ResolvedSkeletonProps = SkeletonProps &
  Required<Pick<SkeletonProps, SkeletonDefaultedKeys>>;

const SKELETON_DEFAULTS: Pick<SkeletonProps, SkeletonDefaultedKeys> = {
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
const definedProps = (props: SkeletonProps): Partial<SkeletonProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<SkeletonProps>;

export const resolveSkeletonProps = (props: SkeletonProps): ResolvedSkeletonProps =>
  ({ ...SKELETON_DEFAULTS, ...definedProps(props) }) as ResolvedSkeletonProps;
