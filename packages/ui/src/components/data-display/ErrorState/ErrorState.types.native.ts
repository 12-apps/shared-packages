import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { ErrorStateBaseProps } from './ErrorState.base';

export type { ErrorStateBaseProps, ErrorStateSeverity } from './ErrorState.base';

/** The native `ErrorState`: the shared contract, plus a `View`'s own props. */
export type ErrorStateProps = ErrorStateBaseProps &
  Omit<ViewProps, keyof ErrorStateBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
