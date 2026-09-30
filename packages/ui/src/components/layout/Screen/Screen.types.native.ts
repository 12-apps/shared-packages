import type { ScrollViewProps, StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { ScreenBaseProps } from './Screen.base';

export type { ScreenBaseProps, ScreenEdge } from './Screen.base';
export type ScreenProps = ScreenBaseProps & Omit<ViewProps, keyof ScreenBaseProps> & {
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Scroll events/indicators; Screen owns orientation, size and keyboard insets. */
  scrollViewProps?: Omit<ScrollViewProps,
    'children' | 'style' | 'contentContainerStyle' | 'horizontal' | 'scrollEnabled' |
    'automaticallyAdjustKeyboardInsets' | 'automaticallyAdjustContentInsets' | 'contentInsetAdjustmentBehavior'
  >;
};
