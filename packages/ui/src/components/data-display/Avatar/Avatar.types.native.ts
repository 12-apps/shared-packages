import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

import type { AvatarBaseProps } from './Avatar.base';

export type {
  AvatarBaseProps,
  AvatarSize,
  AvatarStatus,
  AvatarVariant,
  ContentType,
} from './Avatar.base';

/**
 * The native `Avatar`. `onClick` keeps its web name — a shared screen should
 * not have to know which renderer it is on — and `onPress` is accepted too,
 * because that is what a React Native developer will reach for. Both fire.
 */
export type AvatarProps = AvatarBaseProps &
  Omit<PressableProps, keyof AvatarBaseProps | 'style' | 'onPress'> & {
    onClick?: () => void;
    onPress?: (event: GestureResponderEvent) => void;
    /** Fires when the portrait cannot be loaded. */
    onError?: () => void;
    style?: StyleProp<ViewStyle>;
  };

export interface AvatarGroupProps {
  children?: React.ReactNode;
  max?: number;
  overlap?: number;
  dataTestId?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}
