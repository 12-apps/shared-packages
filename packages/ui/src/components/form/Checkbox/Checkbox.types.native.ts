import type { GestureResponderEvent, StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { CheckboxBaseProps } from './Checkbox.base';
import type { CheckboxSize } from './Checkbox.metrics';

export type { CheckboxBaseProps, CheckboxVariant } from './Checkbox.base';
export type { CheckboxSize } from './Checkbox.metrics';

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
    /** MUI's own words for the glyph's size, which is what this component takes. */
    size?: CheckboxSize;
    onChange?: (event: CheckboxChangeEvent, checked: boolean) => void;
    /** Both spellings fire, as `Button`'s do. */
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
  };
