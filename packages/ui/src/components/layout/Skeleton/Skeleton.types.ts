import type React from 'react';

import type { SkeletonBaseProps } from './Skeleton.base';

export type {
  SkeletonAnimation,
  SkeletonBaseProps,
  SkeletonIntensity,
  SkeletonVariant,
} from './Skeleton.base';

/** The web `Skeleton`: the shared contract, plus the DOM's own two styling hooks. */
export interface SkeletonProps extends SkeletonBaseProps {
  className?: string;
  style?: React.CSSProperties;
}
