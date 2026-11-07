import type { InputOTPBaseProps } from './InputOTP.base';

export type { InputOTPBaseProps, InputOTPVariant } from './InputOTP.base';

/**
 * The web `InputOTP`: the shared contract. Anything else a caller passes
 * (`aria-label`, `className`) reaches the row through its `...rest` spread.
 */
export type InputOTPProps = InputOTPBaseProps;
