import { useTheme, type Theme } from '@mui/material/styles/index.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { rem, remPx } from '../../../tokens/relative';

import type { VirtualGridProps, VirtualListProps } from './VirtualList.types';

type ScrollEvent = React.UIEvent<HTMLDivElement> | Event;
type ListItems = VirtualListProps['items'];
type ListVariant = NonNullable<VirtualListProps['variant']>;
type ItemSize = (index: number) => number;

// Handles both React synthetic events and native DOM events, since the same
// handler serves an internal onScroll and an external container's listener.
const scrollOffsets = (event: ScrollEvent) => {
  const target = (event as React.UIEvent<HTMLDivElement>).currentTarget || (event as Event).target;
  const element = target as HTMLElement;
  return { scrollTop: element.scrollTop, scrollLeft: element.scrollLeft };
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
      const { scrollTop: top, scrollLeft: left } = scrollOffsets(event);
      setScrollTop(top);
      report(top, left);
    },
    [report],
  );

  useExternalScrollListener(scrollContainerRef, handleScroll);

  return { scrollTop, handleScroll };
};


/**
 * A `width` prop as CSS. `sx` reads a number of 1 or less as a fraction of the
 * parent, and that stays so; a larger number is design px, through the type
 * scale; a string is as given.
 */
export const widthCss = (theme: Theme, width: number | string): string => {
  if (typeof width !== 'number') return width;
  return width <= 1 && width !== 0 ? `${width * 100}%` : rem(theme, width);
};

/** Every item's height, its offset from the top, and their sum — all in DESIGN px. */
interface DesignHeights {
  size: ItemSize;
  offset: ItemSize;
  total: number;
}

/**
 * Fixed lists know every height up front; variable ones take the item's own
 * declared height and otherwise the estimate.
 *
 * Kept in the caller's DESIGN px on purpose: the CSS draws a height with `rem`
 * and the range maths reads it through `remPx`, so the two are one number at
 * any type scale — never a row drawn at one pitch and positioned at another.
 */
const useDesignHeights = (
  items: ListItems,
  variant: ListVariant,
  fixed: number,
  estimated: number,
): DesignHeights =>
  useMemo(() => {
    if (variant !== 'variable') {
      return { size: () => fixed, offset: (index) => index * fixed, total: items.length * fixed };
    }

    const size = (index: number): number => items[index]?.height || estimated;
    // Running sums, so an offset is a lookup rather than a walk from the top.
    const starts = [0];
    for (let i = 0; i < items.length; i++) {
      starts.push((starts[i] ?? 0) + size(i));
    }
    return { size, offset: (index) => starts[index] ?? 0, total: starts[items.length] ?? 0 };
  }, [items, variant, fixed, estimated]);

/** The range maths' inputs, in the px the scroll offset is measured in. */
interface RangeArgs {
  count: number;
  scrollTop: number;
  height: number;
  overscan: number;
  itemHeight: number;
  getItemHeight: ItemSize;
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

/**
 * `height`, `itemHeight`, `estimatedItemHeight` and an item's own `height` are
 * design px. The range is computed in the px `scrollTop` is measured in
 * (`remPx`), the viewport and the scroll content are drawn in `rem`, and each
 * item's `top`/`height` is the `remPx` of its design offset and height.
 */
export const useVirtualList = ({
  items,
  variant = 'fixed',
  height,
  itemHeight,
  estimatedItemHeight,
  overscan = 5,
  onScroll,
  scrollContainerRef,
}: VirtualListProps) => {
  const theme = useTheme();
  // 40 design px when the caller does not size a row.
  const design = useDesignHeights(items, variant, itemHeight ?? 40, estimatedItemHeight ?? 40);

  const report = useCallback((top: number) => onScroll?.(top), [onScroll]);
  const { scrollTop, handleScroll } = useScrollTop(scrollContainerRef, report);

  const visibleItems = useMemo(() => {
    const args = {
      count: items.length,
      scrollTop,
      height: remPx(theme, height),
      overscan,
      itemHeight: remPx(theme, design.size(0)),
      getItemHeight: (index: number) => remPx(theme, design.size(index)),
    };
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
          top: remPx(theme, design.offset(i)),
          left: 0,
          width: '100%',
          height: remPx(theme, design.size(i)),
        },
      });
    }

    return result;
  }, [items, scrollTop, height, overscan, variant, design, theme]);

  return {
    totalHeight: rem(theme, design.total),
    viewportHeight: rem(theme, height),
    visibleItems,
    handleScroll,
  };
};

/** The column width in DESIGN px: the caller's, or an even share of a numeric width. */
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

/**
 * `height`, `rowHeight`, `columnWidth` and `gap` are design px: the range and
 * every cell's box are computed through `remPx`, the viewport and the content
 * are drawn through `rem`.
 */
export const useVirtualGrid = ({
  items,
  height,
  width = '100%',
  columnCount,
  rowHeight,
  columnWidth,
  gap = 0,
  overscan = 5,
  onScroll,
  scrollContainerRef,
}: VirtualGridProps) => {
  const theme = useTheme();
  const rowCount = Math.ceil(items.length / columnCount);
  const designColumn = useColumnWidth(columnWidth, width, columnCount, gap);

  const report = useCallback(
    (top: number, left: number) => onScroll?.(top, left),
    [onScroll],
  );
  const { scrollTop, handleScroll } = useScrollTop(scrollContainerRef, report);

  const visibleItems = useMemo(() => {
    const pitch = remPx(theme, rowHeight + gap);
    const stride = remPx(theme, designColumn + gap);
    const startRow = Math.max(0, Math.floor(scrollTop / pitch) - overscan);
    const endRow = Math.min(
      rowCount - 1,
      Math.ceil((scrollTop + remPx(theme, height)) / pitch) + overscan,
    );

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
          left: columnIndex * stride,
          width: remPx(theme, designColumn),
          height: remPx(theme, rowHeight),
        },
      });
    }

    return result;
  }, [items, scrollTop, height, overscan, rowCount, columnCount, rowHeight, gap, designColumn, theme]);

  return {
    totalHeight: rem(theme, rowCount * (rowHeight + gap) - gap),
    viewportHeight: rem(theme, height),
    visibleItems,
    handleScroll,
  };
};
