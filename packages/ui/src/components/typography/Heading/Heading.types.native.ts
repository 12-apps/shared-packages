import type { GestureResponderEvent, StyleProp, TextProps as RNTextProps, TextStyle } from 'react-native';

import type { HeadingBaseProps } from './Heading.base';

export type { HeadingBaseProps, HeadingLevel, HeadingWeight } from './Heading.base';

/**
 * The native `Heading`: the shared contract, plus a react-native `Text`'s own
 * props. `onClick` keeps its web name and `onPress` is accepted too, as on
 * `Button`; both fire.
 */
export type HeadingProps = HeadingBaseProps &
  Omit<RNTextProps, keyof HeadingBaseProps | 'style' | 'onPress'> & {
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<TextStyle>;
  };
