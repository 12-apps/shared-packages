import type { EmptyStateBaseProps } from './EmptyState.base';

export type {
  EmptyStateAction,
  EmptyStateBaseProps,
  EmptyStateHelpLink,
  EmptyStateVariant,
} from './EmptyState.base';

export interface EmptyStateProps extends EmptyStateBaseProps {
  className?: string;
}
