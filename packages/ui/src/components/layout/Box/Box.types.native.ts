import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { BoxBaseProps } from './Box.base';

export type {
  BoxAlign,
  BoxBackground,
  BoxBaseProps,
  BoxDimension,
  BoxDirection,
  BoxJustify,
  BoxRadius,
  BoxSpacingProps,
} from './Box.base';
export { BOX_BASE_KEYS } from './Box.base';

/** The native `Box`: the neutral props, plus a `View`'s own where they do not overlap. */
export type BoxProps = BoxBaseProps &
  Omit<ViewProps, keyof BoxBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
