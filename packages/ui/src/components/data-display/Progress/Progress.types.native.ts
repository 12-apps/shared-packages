import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { ProgressBaseProps } from './Progress.base';

export type { ProgressBaseProps, ProgressSize, ProgressVariant } from './Progress.base';

/** The native `Progress`: the shared contract, plus a `View`'s own props. */
export type ProgressProps = ProgressBaseProps &
  Omit<ViewProps, keyof ProgressBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
