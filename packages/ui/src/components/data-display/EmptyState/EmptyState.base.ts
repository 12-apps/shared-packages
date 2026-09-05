import type * as React from 'react';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * Imports no MUI and no react-native, on purpose: it ships in both
 * declaration outputs. The action handlers take no event on either side, so
 * they live here; the web adds `className`, the native side a `View`'s own
 * props.
 */
export type EmptyStateVariant = 'default' | 'illustrated' | 'minimal' | 'action';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateHelpLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface EmptyStateBaseProps {
  variant?: EmptyStateVariant;
  title: string;
  description?: string;
  illustration?: React.ReactNode; // SVG/Lottie/etc
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  helpLink?: EmptyStateHelpLink;
  /**
   * Callback for the refresh button
   * Displays a refresh button in the action area when provided
   */
  onRefresh?: () => void;
  /**
   * Custom label for the refresh button
   * @default 'Refresh'
   */
  refreshLabel?: string;
  /**
   * Callback for the create/add new button
   * Displays a create button in the action area when provided
   */
  onCreate?: () => void;
  /**
   * Custom label for the create button
   * @default 'Create New'
   */
  createLabel?: string;
  dataTestId?: string;
  testID?: string;
}
