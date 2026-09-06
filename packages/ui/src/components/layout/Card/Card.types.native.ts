import type {
  GestureResponderEvent,
  NativeSyntheticEvent,
  StyleProp,
  TargetedEvent,
  ViewProps,
  ViewStyle,
} from 'react-native';

import type {
  CardActionsBaseProps,
  CardBaseProps,
  CardContentBaseProps,
  CardHeaderBaseProps,
  CardMediaBaseProps,
} from './Card.base';

export type {
  CardActionsAlignment,
  CardActionsBaseProps,
  CardBaseProps,
  CardBorderRadius,
  CardContentBaseProps,
  CardEntranceAnimation,
  CardHeaderBaseProps,
  CardMediaBaseProps,
  CardVariant,
} from './Card.base';

/** Everything a native slot takes on top of its shared contract. */
type NativeSlotProps<Base> = Base & Omit<ViewProps, keyof Base | 'style'> & {
  style?: StyleProp<ViewStyle>;
};

/**
 * The native `Card`. `onClick` keeps its web name — a shared screen should not
 * have to know which renderer it is on — and `onPress` is accepted too, because
 * that is what a React Native developer reaches for. Both fire.
 *
 * A card with neither handler and no `interactive` renders as a plain `View`,
 * the way the web one is a plain `div`: nothing to press, nothing in the
 * accessibility tree that says otherwise.
 */
export type CardProps = CardBaseProps &
  Omit<ViewProps, keyof CardBaseProps | 'style' | 'onFocus' | 'onBlur'> & {
    style?: StyleProp<ViewStyle>;
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    onFocus?: (event: NativeSyntheticEvent<TargetedEvent>) => void;
    onBlur?: (event: NativeSyntheticEvent<TargetedEvent>) => void;
  };

export type CardHeaderProps = NativeSlotProps<CardHeaderBaseProps>;

export type CardContentProps = NativeSlotProps<CardContentBaseProps>;

export type CardActionsProps = NativeSlotProps<CardActionsBaseProps>;

export type CardMediaProps = NativeSlotProps<CardMediaBaseProps>;
