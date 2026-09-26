import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';

// A server render has no layout to measure, and React warns about
// `useLayoutEffect` there; the effect below only measures, so on the server
// it can be a plain (never-run) effect.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

import { remPx } from '../../../tokens/relative';

import type { ColumnConfig, TableProps, VirtualWindow } from './Table.types';

/**
 * The virtual window. `rowHeight` and `containerHeight` are design px: the
 * window is computed in the px `scrollTop` is measured in (`remPx`), and what it
 * hands back to draw with stays in design px (`offsetY`, `trailingPx` — the
 * spacer rows either side of the window), so the rows and the window share one
 * pitch at any type scale.
 *
 * The scroller holds the header as well as the body, so the `<tbody>` starts
 * the header's height into it. That height is measured once after mount, and
 * again from a `ResizeObserver` on `headerRef` whenever it changes —
 * `handleScroll` also measures it on every scroll, so a scroll still carries
 * the latest height, but nothing depends on that any more (FUT-2678: a
 * resize with no scroll event used to leave the window off until the next
 * one). The window subtracts the measured height before dividing by the pitch
 * (FUT-2658).
 */
export const useVirtualScrolling = (
  data: Record<string, unknown>[],
  rowHeight: number,
  containerHeight: number,
  overscan: number = 5,
  headerRef?: React.RefObject<HTMLElement | null>,
) => {
  const theme = useTheme();
  // Both live px, as the browser measures them.
  const [scroll, setScroll] = useState({ scrollTop: 0, headerPx: 0 });

  const measureHeader = useCallback(() => {
    setScroll((prev) => {
      const headerPx = headerRef?.current?.offsetHeight ?? 0;
      return headerPx === prev.headerPx ? prev : { ...prev, headerPx };
    });
  }, [headerRef]);

  // Once after mount, so a header measured before any scroll or resize is
  // still right the first time the window is drawn.
  useIsomorphicLayoutEffect(() => {
    measureHeader();
  }, [measureHeader]);

  // Then on every change the header makes on its own: a responsive column
  // hidden or shown, a label wrapping at a new width, a web font loading, a
  // `density` change. Where `ResizeObserver` is undefined, only the mount
  // measurement above and `handleScroll` below still apply.
  useEffect(() => {
    const header = headerRef?.current;
    if (!header || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => measureHeader());
    observer.observe(header);
    return () => observer.disconnect();
  }, [headerRef, measureHeader]);

  const visibleItems = useMemo((): VirtualWindow => {
    const pitch = remPx(theme, rowHeight);
    const bodyScrollTop = Math.max(0, scroll.scrollTop - scroll.headerPx);
    const startIndex = Math.floor(bodyScrollTop / pitch);
    const endIndex = Math.min(
      data.length,
      Math.ceil((bodyScrollTop + remPx(theme, containerHeight)) / pitch)
    );
    
    const start = Math.max(0, startIndex - overscan);
    const end = Math.min(data.length, endIndex + overscan);
    
    return {
      startIndex: start,
      endIndex: end,
      items: data.slice(start, end),
      offsetY: start * rowHeight,
      trailingPx: (data.length - end) * rowHeight,
    };
  }, [data, rowHeight, containerHeight, scroll, overscan, theme]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScroll({
      scrollTop: e.currentTarget.scrollTop,
      headerPx: headerRef?.current?.offsetHeight ?? 0,
    });
  }, [headerRef]);

  return { visibleItems, handleScroll };
};

// Responsive Hook

const useResponsive = (
  columns: ColumnConfig[],
  columnPriorities?: number[]
) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
  
  const [hiddenColumns, setHiddenColumns] = useState<number[]>([]);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    if (!columnPriorities) return;
    
    let columnsToHide: number[] = [];
    
    if (isMobile) {
      // Hide lowest priority columns on mobile
      columnsToHide = columnPriorities
        .map((priority, index) => ({ priority, index }))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, Math.floor(columns.length / 2))
        .map(item => item.index);
    } else if (isTablet) {
      // Hide some columns on tablet
      columnsToHide = columnPriorities
        .map((priority, index) => ({ priority, index }))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, Math.floor(columns.length / 3))
        .map(item => item.index);
    }
    
    setHiddenColumns(columnsToHide);
  }, [isMobile, isTablet, columnPriorities, columns.length]);

  const visibleColumns = columns.filter((_, index) => !hiddenColumns.includes(index));

  return {
    visibleColumns,
    hiddenColumns,
    isMobile,
    columnMenuAnchor,
    setColumnMenuAnchor,
    setHiddenColumns,
  };
};

// Enhanced Table Header Component
// Visible/hidden column split for responsive mode, plus row selection.
export const useTableSelection = ({
  columns,
  data,
  responsive,
  columnPriorities,
  selectedRows,
  rowKeyExtractor,
  onSelectionChange,
}: {
  columns?: ColumnConfig[];
  data: TableProps['data'];
  responsive?: boolean;
  columnPriorities?: number[];
  selectedRows: (string | number)[];
  rowKeyExtractor?: (row: Record<string, unknown>, index: number) => string | number;
  onSelectionChange?: TableProps['onSelectionChange'];
}) => {
    
  // Use responsive hook if responsive mode is enabled
  const {
    visibleColumns,
    hiddenColumns,
    isMobile,
    columnMenuAnchor,
    setColumnMenuAnchor,
    setHiddenColumns,
  } = useResponsive(
    columns || [],
    responsive ? columnPriorities : undefined
  );

  // Handle selection changes
  const handleSelectionChange = useCallback((rowKey: string | number, selected: boolean) => {
    if (!onSelectionChange) return;
    
    let newSelection: (string | number)[];
    if (selected) {
      newSelection = [...selectedRows, rowKey];
    } else {
      newSelection = selectedRows.filter(key => key !== rowKey);
    }
    onSelectionChange(newSelection);
  }, [selectedRows, onSelectionChange]);

  const handleSelectAll = useCallback((selected: boolean) => {
    if (!onSelectionChange || !data) return;
    
    if (selected) {
      const allKeys = data.map((rowData, index) => 
        rowKeyExtractor ? rowKeyExtractor(rowData, index) : (rowData.id as string | number) || index
      );
      onSelectionChange(allKeys);
    } else {
      onSelectionChange([]);
    }
  }, [data, onSelectionChange, rowKeyExtractor]);

  // Loading state

  return {
    visibleColumns,
    hiddenColumns,
    isMobile,
    columnMenuAnchor,
    setColumnMenuAnchor,
    setHiddenColumns,
    handleSelectionChange,
    handleSelectAll,
  };
};
