import { useCallback, useEffect, useRef, useState } from 'react';

import type { InfiniteScrollProps } from './InfiniteScroll.types';

type ScrollableTarget = InfiniteScrollProps['scrollableTarget'];

/** A string target is looked up by id first, then as a selector. */
const resolveScrollable = (scrollableTarget: ScrollableTarget): Element | null => {
  if (!scrollableTarget) return null;

  if (typeof scrollableTarget === 'string') {
    return (
      document.getElementById(scrollableTarget) || document.querySelector(scrollableTarget)
    );
  }

  return scrollableTarget;
};

interface ObserverArgs {
  testMode: boolean;
  threshold: number;
  scrollableTarget: ScrollableTarget;
}

/**
 * Watches a zero-size sentinel at the end of the list. `rootMargin` is what makes
 * it fire before the sentinel is actually on screen, so the next page is already
 * loading by the time the user reaches the bottom.
 */
export const useSentinel = ({ testMode, threshold, scrollableTarget }: ObserverArgs) => {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    if (testMode || !sentinelRef.current) return;

    const observer = new window.IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setIsIntersecting(entry.isIntersecting);
        }
      },
      {
        root: resolveScrollable(scrollableTarget) || undefined,
        rootMargin: `${threshold}px`,
        threshold: 0,
      },
    );

    observer.observe(sentinelRef.current);

    return () => observer.disconnect();
  }, [testMode, threshold, scrollableTarget]);

  return { sentinelRef, isIntersecting };
};

type LoadArgs = Pick<
  InfiniteScrollProps,
  'hasMore' | 'loading' | 'error' | 'loadMore' | 'onError' | 'testTriggerRef'
> & {
  isIntersecting: boolean;
  testMode: boolean;
};

/**
 * A ref rather than state guards re-entry, so a second intersection landing while
 * the first `loadMore` is still in flight is dropped rather than queued.
 */
export const useLoadMore = ({
  hasMore,
  loading,
  error,
  loadMore,
  onError,
  isIntersecting,
  testMode,
  testTriggerRef,
}: LoadArgs) => {
  const loadingRef = useRef(false);

  const handleLoadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore || error) {
      return;
    }

    loadingRef.current = true;

    try {
      await loadMore();
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
      onError?.(errorObj);
    } finally {
      loadingRef.current = false;
    }
  }, [hasMore, error, loadMore, onError]);

  // Expose test trigger for test mode
  useEffect(() => {
    if (testMode && testTriggerRef) {
      testTriggerRef.current = handleLoadMore;
    }

    return () => {
      if (testMode && testTriggerRef) {
        testTriggerRef.current = undefined;
      }
    };
  }, [testMode, testTriggerRef, handleLoadMore]);

  useEffect(() => {
    if (isIntersecting && hasMore && !loading && !error) {
      handleLoadMore();
    }
  }, [isIntersecting, hasMore, loading, error, handleLoadMore]);
};
