import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { SelectBaseProps, SelectOption, SelectValue } from './Select.base';

export type { SelectBaseProps, SelectOption, SelectValue, SelectVariant } from './Select.base';

/**
 * The change a native `Select` reports.
 *
 * Shaped as `{ target: { value } }` on purpose: that is what MUI's
 * `SelectChangeEvent` gives the 40-odd `onChange={(e) => set(e.target.value)}`
 * handlers in the origin apps, and a screen shared between the renderers
 * should not have to read the value out of two different places. The chosen
 * option arrives as the second argument, where MUI passes the menu item.
 */
export interface SelectChangeEvent {
  target: { value: SelectValue; name?: string };
}

/** The native `Select`: the shared contract, plus a `View`'s own props. */
export type SelectProps = SelectBaseProps &
  Omit<ViewProps, keyof SelectBaseProps | 'style'> & {
    value?: SelectValue;
    defaultValue?: SelectValue;
    onChange?: (event: SelectChangeEvent, option: SelectOption) => void;
    /** Fired when the option list opens and closes, as MUI's `Select` does. */
    onOpen?: () => void;
    onClose?: () => void;
    style?: StyleProp<ViewStyle>;
  };
