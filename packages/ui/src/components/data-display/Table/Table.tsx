import {
  useMediaQuery,
  useTheme} from '@mui/material';
import React, { useCallback,useEffect, useState } from 'react';

import type {
  ColumnConfig,
  TableProps} from './Table.types';
import { EnhancedTableHeader } from './TableParts';
import { AdvancedTable, BasicTable, EmptyTable, LoadingTable } from './TableStates';

// Define pulse animation

// Virtual Scrolling Hook
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
const useTableSelection = ({
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

const TABLE_DEFAULTS: Partial<TableProps> = {
  variant: 'default',
  stripeColor: 'neutral',
  glow: false,
  pulse: false,
  hoverable: false,
  loading: false,
  density: 'normal',
  stickyHeader: false,
  selectable: false,
  selectedRows: [],
  sortable: false,
  virtualScrolling: false,
  rowHeight: 52,
  overscan: 5,
  responsive: false,
  showColumnToggle: true,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default as a destructuring default would. Eighteen separate
// destructuring defaults were most of this component's branch count.
const definedProps = (props: TableProps): Partial<TableProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<TableProps>;


// Which of the four renders a set of props asks for. The order matters: a
// loading table says nothing about its data, and an empty one still has columns
// to draw a header from.
const OWN_PROP_KEYS = [
  'variant', 'stripeColor', 'glow', 'pulse', 'hoverable', 'loading', 'children',
  'density', 'stickyHeader', 'selectable', 'selectedRows', 'onSelectionChange',
  'rowKeyExtractor', 'sortable', 'sortConfig', 'onSortChange', 'columns', 'data',
  'virtualScrolling', 'rowHeight', 'overscan', 'responsive', 'columnPriorities',
  'showColumnToggle', 'containerHeight', 'loadingComponent', 'emptyStateComponent',
  'renderRow', 'renderCell', 'onRowClick', 'onRowFocus', 'onRowBlur',
];

// Anything not in OWN_PROP_KEYS belongs to the underlying MUI table.
const forwardedProps = (table: TableProps): Record<string, unknown> =>
  Object.fromEntries(Object.entries(table).filter(([key]) => !OWN_PROP_KEYS.includes(key)));

// The loading and empty states render the same shell as the populated table,
// so they share TableShell rather than repeating it three times.
const buildShell = ({
  table,
  columns,
  innerRef,
  rest,
  onSelectAll,
}: {
  table: TableProps;
  columns?: ColumnConfig[];
  innerRef: React.Ref<globalThis.HTMLTableElement>;
  rest: Record<string, unknown>;
  onSelectAll: (selected: boolean) => void;
}) => ({
  innerRef,
  variant: table.variant,
  stripeColor: table.stripeColor,
  glow: table.glow,
  pulse: table.pulse,
  hoverable: table.hoverable,
  density: table.density,
  stickyHeader: table.stickyHeader,
  header: columns ? (
    <EnhancedTableHeader
      columns={columns}
      data={[]}
      sortable={table.sortable}
      sortConfig={table.sortConfig}
      onSortChange={table.onSortChange}
      selectable={table.selectable}
      selectedRows={table.selectedRows}
      onSelectAll={onSelectAll}
      density={table.density}
      stickyHeader={table.stickyHeader}
    />
  ) : null,
  rest,
});

export const Table = React.forwardRef<globalThis.HTMLTableElement, TableProps>(
  (tableProps, ref) => {
    const table = { ...TABLE_DEFAULTS, ...definedProps(tableProps) } as TableProps;
    const { columns, data, responsive } = table;
    useTheme(); // Required for responsive behavior

    const selection = useTableSelection({
      columns,
      data,
      responsive,
      columnPriorities: table.columnPriorities,
      selectedRows: table.selectedRows ?? [],
      rowKeyExtractor: table.rowKeyExtractor,
      onSelectionChange: table.onSelectionChange,
    });
    const shownColumns = responsive ? selection.visibleColumns : columns;
    const rest = forwardedProps(table);

    const shell = buildShell({ table, columns: shownColumns ?? columns, innerRef: ref, rest, onSelectAll: selection.handleSelectAll });

    if (table.loading) {
      return (
        <LoadingTable shell={shell} loadingComponent={table.loadingComponent} columns={columns} />
      );
    }

    if (data && data.length === 0) {
      return (
        <EmptyTable
          shell={shell}
          columns={shownColumns}
          emptyStateComponent={table.emptyStateComponent}
        />
      );
    }

    // Advanced table with columns and data
    if (columns && data) {
      return (
        <AdvancedTable
          table={table}
          columns={shownColumns ?? columns}
          data={data}
          innerRef={ref}
          rest={rest}
          selection={selection}
        />
      );
    }

    return <BasicTable table={table} innerRef={ref} rest={rest} />;
  }
);

Table.displayName = 'Table';