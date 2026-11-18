import type { ErrorStateBaseProps } from './ErrorState.base';

export type { ErrorStateBaseProps, ErrorStateIconFrame, ErrorStateSeverity } from './ErrorState.base';

export interface ErrorStateProps extends ErrorStateBaseProps {
  /**
   * Custom className for the container
   */
  className?: string;
}
