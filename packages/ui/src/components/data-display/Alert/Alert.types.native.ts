import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { AlertBaseFields, AlertDismiss } from './Alert.base';

export type { AlertBaseFields, AlertBaseProps, AlertDismiss, AlertVariant } from './Alert.base';

/** The native `Alert`: the shared contract, plus a `View`'s own props where they do not overlap. */
export type AlertProps = AlertBaseFields &
  AlertDismiss &
  Omit<ViewProps, keyof AlertBaseFields | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };
