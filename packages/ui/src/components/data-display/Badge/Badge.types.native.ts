import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { BadgeBaseProps } from './Badge.base';

export type {
  BadgeBaseProps,
  BadgePosition,
  BadgeSize,
  BadgeVariant,
} from './Badge.base';

/** The native `Badge`: the shared contract, plus a `View`'s own props. */
export type BadgeProps = BadgeBaseProps &
  Omit<ViewProps, keyof BadgeBaseProps | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
