import type { ReactNode } from 'react';

export type InfiniteScrollVariant = 'default' | 'reverse' | 'horizontal';

export interface InfiniteScrollProps {
  /**
   * The two states the scroller renders on its own: fetching the next page,
   * and having reached the end. REQUIRED — both were English literals.
   */
  loadingText: string;
  endText: string;
  children: ReactNode;
  variant?: InfiniteScrollVariant;
  hasMore: boolean;
  loading: boolean;
  /**
   * How far before the end the next page is requested (default 150) — design
   * px, scaled with the theme's type scale.
   */
  threshold?: number;
  loadMore: () => void | Promise<void>;
  loader?: ReactNode;
  endMessage?: ReactNode;
  error?: Error | null;
  errorComponent?: ReactNode;
  onError?: (error: Error) => void;
  className?: string;
  style?: React.CSSProperties;
  /**
   * The `horizontal` variant's width. A number of 1 or less is a fraction of
   * the parent (as in `sx`); a larger number is design px, scaled with the
   * theme's type scale; a string is used as given.
   */
  width?: number | string;
  scrollableTarget?: string | HTMLElement; // For custom scroll containers
  /**
   * Test mode: Bypasses IntersectionObserver and provides direct trigger.
   * Use only in test environments.
   * @internal
   */
  testMode?: boolean;
  /**
   * Test trigger: Function to manually trigger load more in test mode.
   * @internal
   */
  testTriggerRef?: React.MutableRefObject<(() => void) | undefined>;
}

export interface InfiniteScrollState {
  loading: boolean;
  hasMore: boolean;
  error: Error | null;
}