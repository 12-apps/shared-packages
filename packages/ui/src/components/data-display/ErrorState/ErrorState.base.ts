import type * as React from 'react';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * Imports no MUI and no react-native, on purpose: it ships in both
 * declaration outputs. `onRetry` takes no event on either side, so it lives
 * here; the web adds `className`, the native side a `View`'s own props.
 */
export type ErrorStateSeverity = 'error' | 'warning';

export interface ErrorStateBaseProps {
  /**
   * The error message to display
   */
  message: string;

  /**
   * Optional title for the error state
   */
  title?: string;

  /**
   * Callback function when retry button is clicked
   */
  onRetry?: () => void;

  /**
   * Custom label for the retry button
   * @default 'Retry'
   */
  retryLabel?: string;

  /**
   * Visual severity of the error
   * @default 'error'
   */
  severity?: ErrorStateSeverity;

  /**
   * Optional custom icon to display
   */
  icon?: React.ReactNode;

  /**
   * Test ID for component testing
   */
  dataTestId?: string;

  testID?: string;
}
