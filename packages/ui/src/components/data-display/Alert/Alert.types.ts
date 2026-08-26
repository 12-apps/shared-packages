import type { ColorValue } from '../../../tokens/scales';
import type { AlertProps as MuiAlertProps } from '@mui/material/Alert';
import type React from 'react';

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
type AlertDismiss =
  | { closable?: false; onClose?: () => void; closeLabel?: never }
  | { closable: true; onClose?: () => void; closeLabel: string };

export type AlertProps = AlertBase & AlertDismiss;

export interface AlertBase extends Omit<MuiAlertProps, 'variant' | 'color' | 'role'> {
  /**
   * The variant of the alert
   */
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'glass' | 'gradient';
  
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
   * ARIA role for the alert
   */
  role?: string;
  
  /**
   * ARIA live region setting
   */
  'aria-live'?: 'polite' | 'assertive' | 'off';
  
  /**
   * ARIA atomic setting
   */
  'aria-atomic'?: 'true' | 'false';

  /**
   * Optional data-testid for testing
   */
  'data-testid'?: string;
}