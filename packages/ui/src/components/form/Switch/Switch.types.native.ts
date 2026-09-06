import type {
  GestureResponderEvent,
  StyleProp,
  ViewProps,
  ViewStyle,
} from 'react-native';

import type { SwitchBaseProps } from './Switch.base';

export type { SwitchBaseProps, SwitchLabelPosition, SwitchVariant } from './Switch.base';

/**
 * The change a native `Switch` reports.
 *
 * Shaped as `{ target: { checked } }` because that is what MUI's
 * `ChangeEvent<HTMLInputElement>` gives the `onChange={(e) =>
 * set(e.target.checked)}` handlers a shared screen already has; the resolved
 * flag arrives as the second argument, exactly as MUI passes it.
 */
export interface SwitchChangeEvent {
  target: { checked: boolean };
}

/** The native `Switch`: the shared contract, plus a `View`'s own props. */
export type SwitchProps = SwitchBaseProps &
  Omit<ViewProps, keyof SwitchBaseProps | 'style'> & {
    checked?: boolean;
    defaultChecked?: boolean;
    onChange?: (event: SwitchChangeEvent, checked: boolean) => void;
    /** Both spellings fire, as `Button`'s do. */
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
  };
