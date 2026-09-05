import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

import type { ChipBaseProps } from './Chip.base';

export type { ChipBaseProps, ChipColor, ChipSize, ChipVariant } from './Chip.base';

/**
 * The native `Chip`. `onClick` keeps its web name — a shared screen should not
 * have to know which renderer it is on — and `onPress` is accepted too, because
 * that is what a React Native developer will reach for. Both fire.
 */
export type ChipProps = ChipBaseProps &
  Omit<PressableProps, keyof ChipBaseProps | 'style' | 'onPress'> & {
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
  };
