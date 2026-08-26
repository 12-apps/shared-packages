import Box from '@mui/material/Box/index.js';
import React, { useRef } from 'react';

import { useVirtualGrid, useVirtualList } from './VirtualList.hooks';
import type { VirtualGridProps, VirtualListProps } from './VirtualList.types';

interface ContainerProps {
  children: React.ReactNode;
  role: 'list' | 'grid';
  totalHeight: number;
  height: number;
  width: number | string;
  disableInternalScroll: boolean;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  className?: string;
  style?: React.CSSProperties;
  dataTestId?: string;
  ariaLabel?: string;
}

/**
 * Two shapes, shared by the list and the grid: when the caller owns the scroll
 * container we render only the full-height content, so their element does the
 * scrolling; otherwise we render our own viewport around it.
 */
const VirtualContainer: React.FC<ContainerProps> = ({
  children,
  role,
  totalHeight,
  height,
  width,
  disableInternalScroll,
  onScroll,
  className,
  style,
  dataTestId,
  ariaLabel,
}) => {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const identity = {
    className,
    'data-testid': dataTestId,
    role,
    'aria-label': ariaLabel,
  };

  if (disableInternalScroll) {
    return (
      <Box {...identity} sx={{ height: totalHeight, width, position: 'relative', ...style }}>
        {children}
      </Box>
    );
  }

  return (
    <Box
      ref={internalContainerRef}
      {...identity}
      sx={{ height, width, overflow: 'auto', position: 'relative', ...style }}
      onScroll={onScroll}
    >
      <Box sx={{ height: totalHeight, position: 'relative' }}>{children}</Box>
    </Box>
  );
};

export const VirtualList: React.FC<VirtualListProps> = ({
  items,
  variant = 'fixed',
  height,
  width = '100%',
  itemHeight = 40,
  estimatedItemHeight = 40,
  overscan = 5,
  renderItem,
  onScroll,
  className,
  style,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
  scrollContainerRef,
  disableInternalScroll = false,
}) => {
  const { totalHeight, visibleItems, handleScroll } = useVirtualList({
    items,
    variant,
    height,
    itemHeight,
    estimatedItemHeight,
    overscan,
    onScroll,
    scrollContainerRef,
  });

  return (
    <VirtualContainer
      role="list"
      totalHeight={totalHeight}
      height={height}
      width={width}
      disableInternalScroll={disableInternalScroll}
      onScroll={handleScroll}
      className={className}
      style={style}
      dataTestId={dataTestId}
      ariaLabel={ariaLabel}
    >
      {visibleItems.map(({ item, index, style: itemStyle }) =>
        renderItem({ item, index, style: itemStyle }),
      )}
    </VirtualContainer>
  );
};

export const VirtualGrid: React.FC<VirtualGridProps> = ({
  items,
  height,
  width = '100%',
  columnCount,
  rowHeight,
  columnWidth,
  gap = 0,
  overscan = 5,
  renderItem,
  onScroll,
  className,
  style,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
  scrollContainerRef,
  disableInternalScroll = false,
}) => {
  const { totalHeight, visibleItems, handleScroll } = useVirtualGrid({
    items,
    height,
    width,
    columnCount,
    rowHeight,
    columnWidth,
    gap,
    overscan,
    onScroll,
    scrollContainerRef,
  });

  return (
    <VirtualContainer
      role="grid"
      totalHeight={totalHeight}
      height={height}
      width={width}
      disableInternalScroll={disableInternalScroll}
      onScroll={handleScroll}
      className={className}
      style={style}
      dataTestId={dataTestId}
      ariaLabel={ariaLabel}
    >
      {visibleItems.map(({ item, index, columnIndex, rowIndex, style: itemStyle }) =>
        renderItem({ item, index, columnIndex, rowIndex, style: itemStyle }),
      )}
    </VirtualContainer>
  );
};
