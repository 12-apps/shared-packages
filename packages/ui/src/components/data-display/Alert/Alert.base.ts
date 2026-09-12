import type * as React from 'react';

import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * Imports no MUI and no react-native, on purpose: it ships in both
 * declaration outputs. The web adds MUI's `AlertProps` extras in
 * `Alert.types.ts`; the native side adds a `View`'s own props in
 * `Alert.types.native.ts`.
 */
export type AlertVariant = 'info' | 'success' | 'warning' | 'danger' | 'glass' | 'gradient';

/**
 * The dismissible half, as a UNION rather than one more optional field.
 *
 * `closeLabel` is the dismiss button's only accessible name — it renders a
 * glyph and nothing else — so it must be REQUIRED wherever that button exists.
 * But most alerts are not closable, and making it required on all of them
 * would ask a dozen call sites across five packages to name a control they
 * never render. A word invented to satisfy a type is worse than no word: the
 * next reader cannot tell which button it belongs to.
 *
 * So the type says what is actually true — the label is required exactly when
 * the button is.
 */
export type AlertDismiss =
  | { closable?: false; onClose?: () => void; closeLabel?: never }
  | { closable: true; onClose?: () => void; closeLabel: string };

export interface AlertBaseFields {
  /**
   * The variant of the alert
   */
  variant?: AlertVariant;

  /**
   * The color of the alert (when not using variant-specific colors)
   */
  color?: ColorValue;

  /**
   * Whether the alert should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the alert should have a pulse animation
   */
  pulse?: boolean;

  /**
   * Custom icon to display
   */
  icon?: React.ReactNode;

  /**
   * Whether to show the default severity icon
   */
  showIcon?: boolean;

  /**
   * Title for the alert
   */
  title?: string;

  /**
   * Description text
   */
  description?: string;

  /**
   * Whether to animate the alert on mount
   */
  animate?: boolean;

  /**
   * Whether this alert INTERRUPTS a screen reader, or waits its turn.
   *
   * Sets `role` and `aria-live` together, which is the whole point of it:
   * those two disagree by default and the disagreement is invisible. An alert
   * gets `role="alert"` from {@link ALERT_DEFAULTS} whatever its variant, and
   * `role="alert"` is IMPLICITLY an assertive live region — so a `polite`
   * `aria-live` beside it is contradicted rather than honoured, and several
   * screen readers interrupt anyway. A caller who wants a quiet announcement
   * has to know that the trick is `role="status"`, which is implicitly polite.
   *
   * `announce` is that knowledge, spelled once:
   *
   * | value | `role` | `aria-live` |
   * |---|---|---|
   * | `'assertive'` | `alert` | `assertive` |
   * | `'polite'` | `status` | `polite` |
   *
   * Unset, nothing changes: the role stays `alert` and the live setting is
   * still derived from the variant ({@link defaultAriaLive}). An explicit
   * `role` or `aria-live` still wins over both, so an existing call site that
   * spells either by hand keeps exactly what it spelled.
   */
  announce?: 'polite' | 'assertive';

  /**
   * ARIA role for the alert. Prefer {@link AlertBaseFields.announce}, which
   * keeps this and `aria-live` consistent; this overrides it.
   */
  role?: string;

  /**
   * ARIA live region setting. Prefer {@link AlertBaseFields.announce}, which
   * keeps this and `role` consistent; this overrides it.
   */
  'aria-live'?: 'polite' | 'assertive' | 'off';

  /**
   * ARIA atomic setting
   */
  'aria-atomic'?: 'true' | 'false';

  children?: React.ReactNode;

  /**
   * Optional data-testid for testing
   */
  'data-testid'?: string;

  dataTestId?: string;

  testID?: string;
}

export type AlertBaseProps = AlertBaseFields & AlertDismiss;
