import type { GestureResponderEvent, StyleProp, TextProps as RNTextProps, TextStyle } from 'react-native';

import type { ParagraphBaseProps } from './Paragraph.base';

export type { ParagraphBaseProps, ParagraphVariant } from './Paragraph.base';

/**
 * The native `Paragraph`: the shared contract, plus a react-native `Text`'s
 * own props. `onClick` keeps its web name and `onPress` is accepted too, as on
 * `Button`; both fire.
 */
export type ParagraphProps = ParagraphBaseProps &
  Omit<RNTextProps, keyof ParagraphBaseProps | 'style' | 'onPress'> & {
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<TextStyle>;
  };
