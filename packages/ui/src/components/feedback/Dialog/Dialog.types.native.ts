import type { ModalProps, StyleProp, ViewProps, ViewStyle } from 'react-native';

import type {
  DialogActionsBaseProps,
  DialogBaseProps,
  DialogContentBaseProps,
  DialogHeaderBaseProps,
} from './Dialog.base';

export type {
  DialogActionsAlignment,
  DialogActionsBaseProps,
  DialogBaseProps,
  DialogBorderRadius,
  DialogContentBaseProps,
  DialogHeaderBaseProps,
  DialogSize,
  DialogVariant,
} from './Dialog.base';

/** Everything a native slot takes on top of its shared contract. */
type NativeSlotProps<Base> = Base & Omit<ViewProps, keyof Base | 'style'> & {
  style?: StyleProp<ViewStyle>;
};

/**
 * The native `Dialog`: the shared contract over React Native's own `Modal`.
 *
 * `Modal`'s props come through so a consumer can pick the presentation
 * (`animationType`, `statusBarTranslucent`, `supportedOrientations`). `visible`
 * is spoken for — `open` is the shared name — and `onRequestClose` is wired to
 * `onClose` unless the dialog is `persistent`, which is what makes the Android
 * back button and the browser's Escape key behave like the web's.
 *
 * `style` lands on the PAPER, the box the web styles through `PaperProps.sx`.
 */
export type DialogProps = DialogBaseProps &
  Omit<ModalProps, keyof DialogBaseProps | 'visible' | 'onRequestClose' | 'style'> & {
    style?: StyleProp<ViewStyle>;
  };

export type DialogHeaderProps = NativeSlotProps<DialogHeaderBaseProps>;

export type DialogContentProps = NativeSlotProps<DialogContentBaseProps>;

export type DialogActionsProps = NativeSlotProps<DialogActionsBaseProps>;
