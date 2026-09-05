import type { StyleProp, TextProps as RNTextProps, TextStyle } from 'react-native';

import type { TextBaseProps } from './Text.base';

export type { TextBaseProps, TextVariant, TextWeight } from './Text.base';

/** The native `Text`: the shared contract, plus a react-native `Text`'s own props. */
export type TextProps = TextBaseProps &
  Omit<RNTextProps, keyof TextBaseProps | 'style'> & {
    style?: StyleProp<TextStyle>;
  };
