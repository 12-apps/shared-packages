import type {
  GestureResponderEvent,
  StyleProp,
  TextInputProps as RNTextInputProps,
  TextStyle,
  ViewStyle,
} from 'react-native';

import type { InputBaseProps } from './Input.base';

export type { InputBaseProps, InputSize, InputVariant } from './Input.base';

/**
 * The native `Input`: the shared contract, plus a react-native `TextInput`'s
 * own props — `value`, `onChangeText`, `keyboardType`, `selection` and the
 * rest — where the contract does not already name them.
 *
 * `onClick` keeps its web name so a shared screen does not have to know which
 * renderer it is on, and `onPress` is accepted too; both fire when the field is
 * pressed. `style` reaches the box the border is drawn on, which is what `sx`
 * dresses on the web; `inputStyle` reaches the `TextInput` inside it.
 */
export type InputProps = InputBaseProps &
  Omit<RNTextInputProps, keyof InputBaseProps | 'style'> & {
    onClick?: (event: GestureResponderEvent) => void;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
  };
