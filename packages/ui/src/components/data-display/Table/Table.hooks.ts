import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { rem, remPx } from '../../../tokens/relative';

import type { ColumnConfig, TableProps, VirtualWindow } from './Table.types';

/**
 * The virtual window. `rowHeight` and `containerHeight` are design px: the
 * window is computed in the px `scrollTop` is measured in (`remPx`), and what it
 * hands back to draw with stays in design px (`offsetY`) or is CSS already
 * (`totalHeight`), so the rows and the window share one pitch at any type scale.
 *
 * The scroller holds the header as well as the body, so the `<tbody>` starts
 * the header's height into it. `handleScroll` measures that height from
 * `headerRef` in the same live px as `scrollTop`, and the window subtracts it
 * before dividing by the pitch (FUT-2658).
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
      totalHeight: rem(theme, data.length * rowHeight),
      offsetY: start * rowHeight,
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
