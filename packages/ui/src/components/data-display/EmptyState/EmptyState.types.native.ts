import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { EmptyStateBaseProps } from './EmptyState.base';

export type {
  EmptyStateAction,
  EmptyStateBaseProps,
  EmptyStateHelpLink,
  EmptyStateVariant,
} from './EmptyState.base';

/** The native `EmptyState`: the shared contract, plus a `View`'s own props. */
export type EmptyStateProps = EmptyStateBaseProps &
  Omit<ViewProps, keyof EmptyStateBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
