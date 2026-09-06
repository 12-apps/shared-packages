import type { AlertBaseFields, AlertVariant } from './Alert.base';
import type { IconName } from '../../../icons/Icon.types';

type AlertDefaultedKeys = 'variant' | 'glow' | 'pulse' | 'showIcon' | 'animate' | 'role' | 'aria-atomic';

export const ALERT_DEFAULTS: Required<Pick<AlertBaseFields, AlertDefaultedKeys>> & { closable: false } = {
  variant: 'info',
  glow: false,
  pulse: false,
  showIcon: true,
  closable: false,
  animate: true,
  role: 'alert',
  'aria-atomic': 'true',
};

/**
 * Generic over the renderer's own props: the web and the native `Alert` pass
 * different extras through, and both come back out untouched.
 */
export type ResolvedAlertProps<P extends AlertBaseFields> = P &
  Required<Pick<AlertBaseFields, AlertDefaultedKeys>>;

// Strips explicitly-undefined props before the merge so `prop={undefined}` still
// falls back to the default, the way a destructuring default would.
const definedProps = <P extends AlertBaseFields>(props: P): Partial<P> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<P>;

// Through `unknown`: `closable: false` in the defaults belongs to the dismiss
// union rather than to `AlertBaseFields`, so TypeScript cannot see the merge as
// comparable to `P` although every field of `P` survives it untouched.
export const resolveAlertProps = <P extends AlertBaseFields>(props: P): ResolvedAlertProps<P> =>
  ({ ...ALERT_DEFAULTS, ...definedProps(props) }) as unknown as ResolvedAlertProps<P>;

/** `danger` announces itself; everything else waits its turn. */
export const defaultAriaLive = (variant: AlertVariant): 'polite' | 'assertive' =>
  variant === 'danger' ? 'assertive' : 'polite';

export const testIdFor = (base: string | undefined, suffix: string): string =>
  base ? `${base}-${suffix}` : `alert-${suffix}`;

/**
 * The glyph each semantic variant carries, by the shared icon set's name.
 * `glass` and `gradient` carry none of their own: the web renders an empty
 * icon slot for them unless the caller passes an `icon`, and so does native.
 */
export const VARIANT_ICON: Partial<Record<AlertVariant, IconName>> = {
  info: 'Info',
  success: 'CheckCircle',
  warning: 'Warning',
  danger: 'Error',
};
