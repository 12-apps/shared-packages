import type { InputBaseProps } from './Input.base';
import { withDefaults } from '../../../utils/withDefaults';

type InputDefaultedKeys =
  | 'variant'
  | 'size'
  | 'error'
  | 'fullWidth'
  | 'floating'
  | 'glow'
  | 'pulse'
  | 'loading'
  | 'disabled'
  | 'required';

/**
 * Generic over the renderer's own props, as `resolveButtonProps` is: the web
 * and the native `Input` pass different handler and `value` types through, and
 * both come back out untouched.
 */
export type ResolvedInputProps<P extends InputBaseProps> = P &
  Required<Pick<InputBaseProps, InputDefaultedKeys>>;

/**
 * The defaults the web `Input` declares in its destructuring. `fullWidth` is
 * true here and false in MUI: a field in this package fills its column unless
 * it is told not to.
 */
const INPUT_DEFAULTS: Required<Pick<InputBaseProps, InputDefaultedKeys>> = {
  variant: 'outlined',
  size: 'md',
  error: false,
  fullWidth: true,
  floating: false,
  glow: false,
  pulse: false,
  loading: false,
  disabled: false,
  required: false,
};

export const resolveInputProps = <P extends InputBaseProps>(props: P): ResolvedInputProps<P> =>
  withDefaults(props, INPUT_DEFAULTS as Partial<P>) as ResolvedInputProps<P>;
