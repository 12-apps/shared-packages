import type {
  GestureResponderEvent,
  NativeSyntheticEvent,
  PressableProps,
  StyleProp,
  TargetedEvent,
  ViewStyle,
} from 'react-native';

import type { ButtonBaseProps } from './Button.base';

export type { ButtonBaseProps, ButtonVariant } from './Button.base';

/**
 * The native `Button`. `onClick` keeps its web name — the 179 call sites in
 * the origin apps spell it that way and a shared screen should not have to
 * know which renderer it is on — and `onPress` is accepted too, because that is
 * what a React Native developer will reach for. Both fire.
 */
export type ButtonProps = ButtonBaseProps &
  Omit<PressableProps, keyof ButtonBaseProps | 'style' | 'onPress' | 'onFocus' | 'onBlur'> & {
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    onFocus?: (event: NativeSyntheticEvent<TargetedEvent>) => void;
    onBlur?: (event: NativeSyntheticEvent<TargetedEvent>) => void;
    style?: StyleProp<ViewStyle>;
  };
