import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { rem, remPx } from '../../../tokens/relative';

import type { ColumnConfig, TableProps } from './Table.types';

/**
 * The virtual window. `rowHeight` and `containerHeight` are design px: the
 * window is computed in the px `scrollTop` is measured in (`remPx`), and what it
 * hands back to draw with stays in design px (`offsetY`) or is CSS already
 * (`totalHeight`), so the rows and the window share one pitch at any type scale.
 */
export const useVirtualScrolling = (
  data: Record<string, unknown>[],
  rowHeight: number,
  containerHeight: number,
  overscan: number = 5
) => {
  const theme = useTheme();
  const [scrollTop, setScrollTop] = useState(0);
  
  const visibleItems = useMemo(() => {
    const pitch = remPx(theme, rowHeight);
    const startIndex = Math.floor(scrollTop / pitch);
    const endIndex = Math.min(
      data.length,
      Math.ceil((scrollTop + remPx(theme, containerHeight)) / pitch)
    );
    
    const start = Math.max(0, startIndex - overscan);
    const end = Math.min(data.length, endIndex + overscan);
    
    return {
      startIndex: start,
      endIndex: end,
      items: data.slice(start, end),
      /** Every row at the scaled pitch, as CSS. */
      totalHeight: rem(theme, data.length * rowHeight),
      /** Where the first mounted row sits, in design px. */
      offsetY: start * rowHeight,
    };
  }, [data, rowHeight, containerHeight, scrollTop, overscan, theme]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

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
