import type React from 'react';

export interface AsyncStateContainerProps {
  /**
   * What an EMPTY result reads as, when the caller supplies no
   * `emptyComponent` of its own. REQUIRED — the fallback was the English
   * "No data available", on the package every host renders.
   */
  emptyTitle: string;
  /**
   * Whether the container is in a loading state
   * @default false
   */
  isLoading?: boolean;

  /**
   * Error message or object. When truthy, shows the error state.
   */
  error?: string | Error | null;

  /**
   * Whether the data is empty (shows empty state when true and not loading/error)
   * @default false
   */
  isEmpty?: boolean;

  /**
   * The content to render when data is available
   */
  children: React.ReactNode;

  /**
   * Component to render during loading state
   * Takes precedence over renderLoading
   */
  loadingComponent?: React.ReactNode;

  /**
   * Render function for loading state
   * Called when loadingComponent is not provided
   */
  renderLoading?: () => React.ReactNode;

  /**
   * Component to render during error state
   * Takes precedence over renderError
   */
  errorComponent?: React.ReactNode;

  /**
   * Render function for error state
   * Receives the error message as parameter
   */
  renderError?: (error: string) => React.ReactNode;

  /**
   * Component to render during empty state
   * Takes precedence over renderEmpty
   */
  emptyComponent?: React.ReactNode;

  /**
   * Render function for empty state
   */
  renderEmpty?: () => React.ReactNode;

  /**
   * Custom className for the container
   */
  className?: string;

  /**
   * Test ID for component testing
   */
  dataTestId?: string;
}
