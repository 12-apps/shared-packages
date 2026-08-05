import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { VirtualGridProps, VirtualListProps } from './VirtualList.types';

type ScrollEvent = React.UIEvent<HTMLDivElement> | Event;
type ListItems = VirtualListProps['items'];
type ListVariant = NonNullable<VirtualListProps['variant']>;
type ItemHeight = (index: number) => number;

// Handles both React synthetic events and native DOM events, since the same
// handler serves an internal onScroll and an external container's listener.
const scrollOffsets = (event: ScrollEvent) => {
  const target = (event as React.UIEvent<HTMLDivElement>).currentTarget || (event as Event).target;
  const element = target as HTMLElement;
  return { top: element.scrollTop, left: element.scrollLeft };
};

/**
 * When the caller owns the scroll container, the component cannot attach
 * `onScroll` through JSX and has to subscribe to that element directly.
 */
const useExternalScrollListener = (
  scrollContainerRef: VirtualListProps['scrollContainerRef'],
  handleScroll: (event: Event) => void,
) => {
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const element = scrollContainerRef.current;
    const scrollHandler = (e: Event) => handleScroll(e);

    element.addEventListener('scroll', scrollHandler);
    return () => element.removeEventListener('scroll', scrollHandler);
  }, [scrollContainerRef, handleScroll]);
};

/**
 * Tracks the scroll offset whether it arrives through our own `onScroll` or
 * through a container the caller owns, and hands both offsets to `report` so a
 * grid can pass on the horizontal one too.
 */
const useScrollTop = (
  scrollContainerRef: VirtualListProps['scrollContainerRef'],
  report: (top: number, left: number) => void,
) => {
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(
    (event: ScrollEvent) => {
      const { top, left } = scrollOffsets(event);
      setScrollTop(top);
      report(top, left);
    },
    [report],
  );

  useExternalScrollListener(scrollContainerRef, handleScroll);

  return { scrollTop, handleScroll };
};

interface HeightArgs {
  items: ListItems;
  variant: ListVariant;
  itemHeight: number;
  estimatedItemHeight: number;
}

/**
 * Fixed lists know every height up front. Variable ones prefer the item's own
 * declared height, fall back to a measurement taken on a previous render, and
 * only then guess.
 */
const useItemHeight = ({
  items,
  variant,
  itemHeight,
  estimatedItemHeight,
}: HeightArgs): ItemHeight => {
  const measured = useRef<Map<number, number>>(new Map());

  return useCallback(
    (index: number): number => {
      if (variant !== 'variable') {
        return itemHeight;
      }

      return items[index]?.height || measured.current.get(index) || estimatedItemHeight;
    },
    [variant, itemHeight, estimatedItemHeight, items],
  );
};

const useTotalHeight = (
  items: ListItems,
  variant: ListVariant,
  itemHeight: number,
  getItemHeight: ItemHeight,
) =>
  useMemo(() => {
    if (variant === 'fixed') {
      return items.length * itemHeight;
    }

    let sum = 0;
    for (let i = 0; i < items.length; i++) {
      sum += getItemHeight(i);
    }
    return sum;
  }, [items.length, variant, itemHeight, getItemHeight]);

interface RangeArgs {
  count: number;
  scrollTop: number;
  height: number;
  overscan: number;
  itemHeight: number;
  getItemHeight: ItemHeight;
}

// Walks forward accumulating heights until it passes the viewport's top edge, then
// its bottom edge. Linear in the number of items, which is why fixed lists take
// the arithmetic shortcut instead.
const variableRange = ({ count, scrollTop, height, overscan, getItemHeight }: RangeArgs) => {
  let accumulated = 0;
  let startIndex = 0;
  let endIndex = count - 1;

  for (let i = 0; i < count; i++) {
    if (accumulated + getItemHeight(i) > scrollTop) {
      startIndex = Math.max(0, i - overscan);
      break;
    }
    accumulated += getItemHeight(i);
  }

  accumulated = 0;
  for (let i = 0; i <= startIndex; i++) {
    accumulated += getItemHeight(i);
  }

  for (let i = startIndex; i < count; i++) {
    if (accumulated > scrollTop + height) {
      endIndex = Math.min(count - 1, i + overscan);
      break;
    }
    accumulated += getItemHeight(i);
  }

  return { startIndex, endIndex };
};

const fixedRange = ({ count, scrollTop, height, overscan, itemHeight }: RangeArgs) => ({
  startIndex: Math.max(0, Math.floor(scrollTop / itemHeight) - overscan),
  endIndex: Math.min(count - 1, Math.ceil((scrollTop + height) / itemHeight) + overscan),
});

const useItemOffset = (
  variant: ListVariant,
  itemHeight: number,
  getItemHeight: ItemHeight,
): ItemHeight =>
  useCallback(
    (index: number): number => {
      if (variant === 'fixed') {
        return index * itemHeight;
      }

      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += getItemHeight(i);
      }
      return offset;
    },
    [variant, itemHeight, getItemHeight],
  );

interface ListArgs {
  items: ListItems;
  variant: ListVariant;
  height: number;
  itemHeight: number;
  estimatedItemHeight: number;
  overscan: number;
  onScroll: VirtualListProps['onScroll'];
  scrollContainerRef: VirtualListProps['scrollContainerRef'];
}

export const useVirtualList = ({
  items,
  variant,
  height,
  itemHeight,
  estimatedItemHeight,
  overscan,
  onScroll,
  scrollContainerRef,
}: ListArgs) => {
  const getItemHeight = useItemHeight({ items, variant, itemHeight, estimatedItemHeight });
  const getItemOffset = useItemOffset(variant, itemHeight, getItemHeight);
  const totalHeight = useTotalHeight(items, variant, itemHeight, getItemHeight);

  const report = useCallback((top: number) => onScroll?.(top), [onScroll]);
  const { scrollTop, handleScroll } = useScrollTop(scrollContainerRef, report);

  const visibleItems = useMemo(() => {
    const args = { count: items.length, scrollTop, height, overscan, itemHeight, getItemHeight };
    const { startIndex, endIndex } = variant === 'fixed' ? fixedRange(args) : variableRange(args);
    const result = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const item = items[i];
      if (!item) continue;

      result.push({
        item,
        index: i,
        style: {
          position: 'absolute' as const,
          top: getItemOffset(i),
          left: 0,
          width: '100%',
          height: getItemHeight(i),
        },
      });
    }

    return result;
  }, [items, scrollTop, height, overscan, variant, itemHeight, getItemOffset, getItemHeight]);

  return { totalHeight, visibleItems, handleScroll };
};

interface GridArgs {
  items: VirtualGridProps['items'];
  height: number;
  width: number | string;
  columnCount: number;
  rowHeight: number;
  columnWidth?: number;
  gap: number;
  overscan: number;
  onScroll: VirtualGridProps['onScroll'];
  scrollContainerRef: VirtualGridProps['scrollContainerRef'];
}

const useColumnWidth = (
  columnWidth: number | undefined,
  width: number | string,
  columnCount: number,
  gap: number,
) =>
  useMemo(() => {
    if (columnWidth) return columnWidth;

    const containerWidth = typeof width === 'number' ? width : 300; // fallback
    return (containerWidth - (columnCount - 1) * gap) / columnCount;
  }, [columnWidth, width, columnCount, gap]);

export const useVirtualGrid = ({
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
}: GridArgs) => {
  const rowCount = Math.ceil(items.length / columnCount);
  const totalHeight = rowCount * (rowHeight + gap) - gap;
  const computedColumnWidth = useColumnWidth(columnWidth, width, columnCount, gap);

  const report = useCallback(
    (top: number, left: number) => onScroll?.(top, left),
    [onScroll],
  );
  const { scrollTop, handleScroll } = useScrollTop(scrollContainerRef, report);

  const visibleItems = useMemo(() => {
    const pitch = rowHeight + gap;
    const startRow = Math.max(0, Math.floor(scrollTop / pitch) - overscan);
    const endRow = Math.min(rowCount - 1, Math.ceil((scrollTop + height) / pitch) + overscan);

    // Rows are contiguous in `items`, so the visible block is one index range
    // rather than a row loop wrapping a column loop.
    const firstIndex = startRow * columnCount;
    const lastIndex = Math.min((endRow + 1) * columnCount - 1, items.length - 1);
    const result = [];

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = items[index];
      if (!item) continue;

      const rowIndex = Math.floor(index / columnCount);
      const columnIndex = index % columnCount;

      result.push({
        item,
        index,
        columnIndex,
        rowIndex,
        style: {
          position: 'absolute' as const,
          top: rowIndex * pitch,
          left: columnIndex * (computedColumnWidth + gap),
          width: computedColumnWidth,
          height: rowHeight,
        },
      });
    }

    return result;
  }, [items, scrollTop, height, overscan, rowCount, columnCount, rowHeight, gap, computedColumnWidth]);

  return { totalHeight, visibleItems, handleScroll };
};
