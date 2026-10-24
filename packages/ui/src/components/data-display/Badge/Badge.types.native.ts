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
    /** The close button's accessible name; defaults to `UI_LABELS['en-US'].common.close`. */
    closeLabel?: string;
    style?: StyleProp<ViewStyle>;
  };
