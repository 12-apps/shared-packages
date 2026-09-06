import type { SwitchBaseProps } from './Switch.base';
import { withDefaults } from '../../../utils/withDefaults';

type SwitchDefaultedKeys =
  | 'variant'
  | 'color'
  | 'size'
  | 'glow'
  | 'glass'
  | 'gradient'
  | 'labelPosition'
  | 'error'
  | 'animated'
  | 'loading'
  | 'ripple'
  | 'pulse'
  | 'disabled';

export type ResolvedSwitchProps<P extends SwitchBaseProps = SwitchBaseProps> = P &
  Required<Pick<SwitchBaseProps, SwitchDefaultedKeys>>;

/** `Switch.tsx`'s own `DEFAULTS`, plus the `disabled` MUI would have defaulted. */
const SWITCH_DEFAULTS: Required<Pick<SwitchBaseProps, SwitchDefaultedKeys>> = {
  variant: 'default',
  color: 'primary',
  size: 'md',
  glow: false,
  glass: false,
  gradient: false,
  labelPosition: 'end',
  error: false,
  animated: true,
  loading: false,
  ripple: false,
  pulse: false,
  disabled: false,
};

export const resolveSwitchProps = <P extends SwitchBaseProps>(props: P): ResolvedSwitchProps<P> =>
  withDefaults(props, SWITCH_DEFAULTS as Partial<P>) as ResolvedSwitchProps<P>;

/**
 * Every prop the switch consumes itself.
 *
 * Listed so what is left over — `aria-label`, `aria-describedby`, an `id` — can
 * be spread onto the control without the component's own props riding along.
 * react-native-web would drop them and React Native ignore them, but a prop
 * that reaches an element it means nothing to is a prop nobody can explain.
 */
export const SWITCH_BASE_KEYS = [
  'variant', 'color', 'size', 'label', 'description', 'glow', 'glass', 'gradient',
  'labelPosition', 'onIcon', 'offIcon', 'onText', 'offText', 'error', 'helperText',
  'trackWidth', 'trackHeight', 'animated', 'loading', 'ripple', 'pulse', 'disabled',
  'testID', 'dataTestId', 'data-testid',
] as const satisfies ReadonlyArray<keyof SwitchBaseProps | 'data-testid'>;

/** `props` without any of them, for spreading onto the control. */
export function withoutSwitchProps(props: object): Record<string, unknown> {
  const own = new Set<string>(SWITCH_BASE_KEYS);
  return Object.fromEntries(Object.entries(props).filter(([key]) => !own.has(key)));
}
