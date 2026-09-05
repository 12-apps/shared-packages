import type { LoadingStateBaseProps } from './LoadingState.base';

export type { LoadingStateBaseProps, LoadingStateSize, LoadingStateVariant } from './LoadingState.base';

export interface LoadingStateProps extends LoadingStateBaseProps {
  /**
   * Custom className for the container
   */
  className?: string;
}
