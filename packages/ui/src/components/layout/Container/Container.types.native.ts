import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { ContainerBaseProps } from './Container.base';

export type { ContainerBaseProps, ContainerMaxWidth, ContainerPadding, ContainerVariant } from './Container.base';

/** The native `Container`: the shared contract, plus a `View`'s own props where they do not overlap. */
export type ContainerProps = ContainerBaseProps &
  Omit<ViewProps, keyof ContainerBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
