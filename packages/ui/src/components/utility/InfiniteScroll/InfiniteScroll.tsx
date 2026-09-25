import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { rem, remPx } from '../../../tokens/relative';

import { useLoadMore, useSentinel } from './InfiniteScroll.hooks';
import {
  containerStyles,
  DefaultEndMessage,
  DefaultError,
  DefaultLoader,
} from './InfiniteScroll.parts';
import type { InfiniteScrollProps } from './InfiniteScroll.types';

export const InfiniteScroll: React.FC<InfiniteScrollProps> = ({
  children,
  variant = 'default',
  hasMore,
  loading,
  threshold,
  loadMore,
  loader,
  loadingText,
  endText,
  endMessage,
  error,
  errorComponent,
  onError,
  className,
  style,
  width,
  scrollableTarget,
  testMode = false,
  testTriggerRef,
}) => {
  const theme = useTheme();
  // 150 design px unless the caller says; `rootMargin` only takes px.
  const rootMargin = `${remPx(theme, threshold ?? 150)}px`;
  const { sentinelRef, isIntersecting } = useSentinel({ testMode, rootMargin, scrollableTarget });

  useLoadMore({
    hasMore,
    loading,
    error,
    loadMore,
    onError,
    isIntersecting,
    testMode,
    testTriggerRef,
  });

  // The tail of the list is one of four things: the end message, an error, a
  // spinner, or the sentinel that asks for the next page.
  const renderSentinel = () => {
    if (!hasMore) return endMessage || <DefaultEndMessage endText={endText} />;
    if (error) return errorComponent || <DefaultError error={error} />;
    if (loading) return loader || <DefaultLoader loadingText={loadingText} />;

    return (
      <div
        ref={sentinelRef}
        data-testid="infinite-scroll-sentinel"
        style={{
          height: variant === 'horizontal' ? '100%' : rem(theme, 1),
          width: variant === 'horizontal' ? rem(theme, 1) : '100%',
        }}
      />
    );
  };

  return (
    <Box
      className={className}
      sx={{
        ...containerStyles(theme, variant, width),
        ...style,
      }}
    >
      {variant === 'reverse' && renderSentinel()}

      {variant === 'horizontal' ? (
        <Box sx={{ display: 'flex', flexDirection: 'row' }}>{children}</Box>
      ) : (
        children
      )}

      {variant !== 'reverse' && renderSentinel()}

      {variant === 'horizontal' && renderSentinel()}
    </Box>
  );
};
