import type { CheckboxBaseProps } from './Checkbox.base';
import { withDefaults } from '../../../utils/withDefaults';

type CheckboxDefaultedKeys = 'variant' | 'ripple' | 'glow' | 'pulse';

/**
 * Generic over the renderer's own props, as `resolveButtonProps` is: the web
 * and the native `Checkbox` pass different handler types through, and both come
 * back out untouched.
 */
export type ResolvedCheckboxProps<P extends CheckboxBaseProps = CheckboxBaseProps> = P &
  Required<Pick<CheckboxBaseProps, CheckboxDefaultedKeys>>;

const CHECKBOX_DEFAULTS: Required<Pick<CheckboxBaseProps, CheckboxDefaultedKeys>> = {
  variant: 'default',
  ripple: true,
  glow: false,
  pulse: false,
};

export const resolveCheckboxProps = <P extends CheckboxBaseProps>(props: P): ResolvedCheckboxProps<P> =>
  withDefaults(props, CHECKBOX_DEFAULTS as Partial<P>) as ResolvedCheckboxProps<P>;

/** `${dataTestId}-${suffix}`, or `checkbox-${suffix}` when the caller named nothing. */
export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `checkbox-${suffix}`;
