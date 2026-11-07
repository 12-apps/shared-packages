import type { StyleProp, ViewStyle } from 'react-native';

import type { InputOTPBaseProps } from './InputOTP.base';
import type { InputOTPLabels } from '../../../copy/labels';

export type { InputOTPBaseProps, InputOTPVariant } from './InputOTP.base';
export type { InputOTPLabels } from '../../../copy/labels';

/**
 * The native `InputOTP`: the shared contract, plus what the web takes only
 * through its `...rest` spread and a native row has to name.
 *
 * `aria-label` names the ROW — a `role="group"`, as on the web — so a screen
 * reader announces the slots as one code. Each slot is named by `labels.slot`
 * ("Digit 1 of 6" in the English pack; a pt-BR host passes
 * `UI_LABELS['pt-BR'].inputOtp`). `style` reaches the row, which is what `sx`
 * dresses on the web.
 */
export interface InputOTPProps extends InputOTPBaseProps {
  'aria-label'?: string;
  style?: StyleProp<ViewStyle>;
  labels?: Partial<InputOTPLabels>;
  /** React Native's spelling of `dataTestId`; either names the row. */
  testID?: string;
  'data-testid'?: string;
}
