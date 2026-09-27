import type { GestureResponderEvent, StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { CheckboxBaseProps } from './Checkbox.base';

export type { CheckboxBaseProps, CheckboxSize, CheckboxVariant } from './Checkbox.base';

/**
 * The change a native `Checkbox` reports: the `{ target: { checked } }` shape
 * MUI's `ChangeEvent` gives, and the resolved flag second, as MUI passes it.
 */
export interface CheckboxChangeEvent {
  target: { checked: boolean };
}

/** The native `Checkbox`: the shared contract, plus a `View`'s own props. */
export type CheckboxProps = CheckboxBaseProps &
  Omit<ViewProps, keyof CheckboxBaseProps | 'style'> & {
    checked?: boolean;
    defaultChecked?: boolean;
    onChange?: (event: CheckboxChangeEvent, checked: boolean) => void;
    /** Both spellings fire, as `Button`'s do. */
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
  };
