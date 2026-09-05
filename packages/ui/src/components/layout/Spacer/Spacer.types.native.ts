import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { SpacerBaseProps } from './Spacer.base';

export type { SpacerBaseProps, SpacerDimension, SpacerDirection, SpacerSize } from './Spacer.base';

/** The native `Spacer`: the shared contract, plus a `View`'s own props where they do not overlap. */
export type SpacerProps = SpacerBaseProps &
  Omit<ViewProps, keyof SpacerBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
