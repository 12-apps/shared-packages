import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { SkeletonBaseProps } from './Skeleton.base';

export type {
  SkeletonAnimation,
  SkeletonBaseProps,
  SkeletonIntensity,
  SkeletonVariant,
} from './Skeleton.base';

/** The native `Skeleton`: the shared contract, plus a `View`'s own props. */
export type SkeletonProps = SkeletonBaseProps &
  Omit<ViewProps, keyof SkeletonBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
