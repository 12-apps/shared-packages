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
 * that is what a React Native developer will reach for.
 *
 * A press fires BOTH. A keyboard activation fires only `onClick`: it exists
 * solely under react-native-web, where a selectable chip is an `option` and
 * `Pressable` answers Space only on a `button` role, so the chip synthesizes
 * the activation itself and has no `GestureResponderEvent` to hand `onPress`.
 * That matches the web, whose chip has no `onPress` at all, and costs nothing
 * on a device, which has no keyboard to activate from.
 */
export type ChipProps = ChipBaseProps &
  Omit<PressableProps, keyof ChipBaseProps | 'style' | 'onPress'> & {
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
  };
