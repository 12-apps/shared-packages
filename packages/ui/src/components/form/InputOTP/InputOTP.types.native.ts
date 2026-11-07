import type { StyleProp, ViewStyle } from 'react-native';

import type { InputOTPBaseProps } from './InputOTP.base';

/**
 * The native `InputOTP`'s props: the shared contract, plus the group's
 * accessible name (the web takes it as a plain `aria-label` attribute) and the
 * row's `style`.
 */
export interface InputOTPProps extends InputOTPBaseProps {
  /** Names the boxes together, as one group. */
  'aria-label'?: string;
  /** The row's own style; the boxes keep theirs. */
  style?: StyleProp<ViewStyle>;
}
