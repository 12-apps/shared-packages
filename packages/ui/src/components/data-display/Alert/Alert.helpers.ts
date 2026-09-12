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

/**
 * The ARIA role each `announce` level is spelled with.
 *
 * Both roles carry an IMPLICIT live setting, and that implicit one is what
 * assistive tech acts on — `alert` is assertive, `status` is polite. Pairing
 * them here is what stops `role` and `aria-live` from contradicting each
 * other, which they do by default: every alert is `role="alert"` regardless of
 * variant, so an `info` alert asks to be polite in one attribute and to
 * interrupt in the other.
 */
export const ANNOUNCE_ROLE: Record<NonNullable<AlertBaseFields['announce']>, string> = {
  assertive: 'alert',
  polite: 'status',
};

/**
 * The two attributes that decide whether an alert interrupts, resolved TOGETHER.
 *
 * Both renderers therefore let `role` and `announce` leave their destructure
 * unused (`_role`, `_announce`) and call this instead — the first because the
 * defaults have already answered it, the second because it must never reach
 * the DOM.
 *
 * Reads the caller's own props rather than the defaulted ones, because the
 * whole question is which of them the caller actually spelled:
 * {@link ALERT_DEFAULTS} supplies `role: 'alert'` for everything, so after the
 * merge there is no longer any difference between an alert that asked to
 * interrupt and one that never mentioned it.
 *
 * Precedence, most specific first — an explicit `role` or `aria-live` beats
 * `announce`, so a call site that already spells either by hand is untouched:
 *
 *  1. `role` / `aria-live` as given;
 *  2. {@link AlertBaseFields.announce}, which supplies both;
 *  3. today's behaviour — `ALERT_DEFAULTS.role` and {@link defaultAriaLive}.
 *
 * With none of the three named, the result is byte-for-byte what it was before
 * `announce` existed.
 */
export const resolveAnnouncement = (
  props: Pick<AlertBaseFields, 'announce' | 'role' | 'aria-live'>,
  variant: AlertVariant,
): { role: string; 'aria-live': 'polite' | 'assertive' | 'off' } => {
  const announce = props.announce;
  return {
    role: props.role ?? (announce === undefined ? ALERT_DEFAULTS.role : ANNOUNCE_ROLE[announce]),
    'aria-live': props['aria-live'] ?? announce ?? defaultAriaLive(variant),
  };
};

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
