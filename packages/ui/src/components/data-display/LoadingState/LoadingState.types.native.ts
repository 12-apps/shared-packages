import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { LoadingStateBaseProps } from './LoadingState.base';

export type { LoadingStateBaseProps, LoadingStateSize, LoadingStateVariant } from './LoadingState.base';

/** The native `LoadingState`: the shared contract, plus a `View`'s own props. */
export type LoadingStateProps = LoadingStateBaseProps &
  Omit<ViewProps, keyof LoadingStateBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
