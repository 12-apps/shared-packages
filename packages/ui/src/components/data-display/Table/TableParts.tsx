import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import React, { useCallback } from 'react';

import { useVirtualScrolling } from './Table.hooks';
import { useTableRowRenderer } from './TableParts.hooks';
import type { ColumnConfig, TableBodyProps, TableHeaderProps } from './Table.types';

// Mirrors the visible sort indicator for assistive technology; undefined when
// the column is not sorted, which is what removes the attribute entirely.
const ariaSortFor = (
  canSort: boolean,
  isSorted: boolean,
  direction?: 'asc' | 'desc',
): 'ascending' | 'descending' | undefined => {
  if (!canSort || !isSorted) return undefined;

  return direction === 'asc' ? 'ascending' : 'descending';
};

// One header cell. Sorting is offered when the table is sortable and the column
// has not opted out; aria-sort mirrors the visible indicator.
const HeaderCell: React.FC<{
  column: ColumnConfig;
  sortable?: boolean;
  sortConfig?: { key: string; direction: 'asc' | 'desc' };
  onSort: (columnKey: string) => void;
}> = ({ column, sortable, sortConfig, onSort }) => {
  const canSort = Boolean(sortable) && column.sortable !== false;
  const isSorted = sortConfig?.key === column.key;

  return (
    <TableCell
      align={column.align || 'left'}
      style={{ minWidth: column.minWidth, width: column.width }}
      aria-sort={ariaSortFor(canSort, isSorted, sortConfig?.direction)}
    >
      {canSort ? (
        <TableSortLabel
          active={isSorted}
          direction={isSorted ? sortConfig?.direction : 'asc'}
          onClick={() => onSort(column.key)}
          data-testid="sort-indicator"
          aria-label={`Sort by ${column.label}`}
        >
          {column.label}
        </TableSortLabel>
      ) : (
        column.label
      )}
    </TableCell>
  );
};

export const EnhancedTableHeader: React.FC<TableHeaderProps> = React.memo(({
  columns,
  data,
  sortable,
  sortConfig,
  onSortChange,
  selectable,
  selectedRows = [],
  onSelectAll }) => {
  const handleSort = useCallback(
    (columnKey: string) => {
      if (!sortable || !onSortChange) return;
      
      const direction = 
        sortConfig?.key === columnKey && sortConfig.direction === 'asc' ? 'desc' : 'asc';
      onSortChange(columnKey, direction);
    },
    [sortable, onSortChange, sortConfig]
  );

  const handleSelectAll = useCallback(
    (event: React.ChangeEvent<globalThis.HTMLInputElement>) => {
      if (!onSelectAll) return;
      onSelectAll(event.target.checked);
    },
    [onSelectAll]
  );

  return (
    <TableHead>
      <TableRow>
        {selectable && (
          <TableCell padding="checkbox">
            <Checkbox
              indeterminate={selectedRows.length > 0 && selectedRows.length < data.length}
              checked={selectedRows.length === data.length && data.length > 0}
              onChange={handleSelectAll}
              inputProps={{ 'aria-label': 'select all' }}
            />
          </TableCell>
        )}
        {columns.map((column) => (
          <HeaderCell
            key={column.key}
            column={column}
            sortable={sortable}
            sortConfig={sortConfig}
            onSort={handleSort}
          />
        ))}
      </TableRow>
    </TableHead>
  );
});

EnhancedTableHeader.displayName = 'EnhancedTableHeader';

// One data row. Split out of the memoised renderTableRow callback so the
// callback stays a short dispatch and the row markup is readable on its own.
export const TableDataRow: React.FC<{
  rowData: Record<string, unknown>;
  rowKey: string | number;
  index: number;
  offsetY: number;
  columns: ColumnConfig[];
  selected: boolean;
  selectable?: boolean;
  rowHeight?: number;
  onRowClick?: TableBodyProps['onRowClick'];
  onRowFocus?: TableBodyProps['onRowFocus'];
  onRowBlur?: TableBodyProps['onRowBlur'];
  onSelect: (event: React.MouseEvent | React.ChangeEvent, rowKey: string | number) => void;
  virtualScrolling?: boolean;
  renderCell?: TableBodyProps['renderCell'];
}> = ({
  rowData,
  rowKey,
  index,
  offsetY,
  columns,
  selected,
  selectable,
  rowHeight,
  onRowClick,
  onRowFocus,
  onRowBlur,
  onSelect,
  virtualScrolling,
  renderCell }) => (

      <TableRow
        key={String(rowKey)}
        selected={selected}
        className={selected ? 'selected' : ''}
        onClick={(event: React.MouseEvent<globalThis.HTMLTableRowElement>) => onRowClick?.(event, rowData)}
        onFocus={(event: React.FocusEvent<globalThis.HTMLTableRowElement>) => onRowFocus?.(event, rowData)}
        onBlur={(event: React.FocusEvent<globalThis.HTMLTableRowElement>) => onRowBlur?.(event, rowData)}
        style={virtualScrolling ? { 
          transform: `translateY(${offsetY}px)`,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: rowHeight } : undefined}
      >
        {selectable && (
          <TableCell padding="checkbox">
            <Checkbox
              checked={selected}
              onChange={(event) => onSelect(event, rowKey)}
              onClick={(event) => event.stopPropagation()}
              inputProps={{ 'aria-label': `select row ${index + 1}` }}
            />
          </TableCell>
        )}
        {columns.map((column) => {
          const value = rowData[column.key];
          return (
            <TableCell key={column.key} align={column.align || 'left'}>
              {renderCell 
                ? renderCell(value, column, rowData, index)
                : column.render 
                ? column.render(value, rowData) 
                : (value as React.ReactNode)
              }
            </TableCell>
          );
        })}
      </TableRow>
);

// Only the rows in view are rendered, positioned by absolute offset inside a
// spacer sized to the full data set.
const VirtualisedBody: React.FC<{
  visibleItems: {
    items: Record<string, unknown>[];
    startIndex: number;
    offsetY: number;
    totalHeight: number;
  };
  rowHeight: number;
  containerHeight: number;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  renderTableRow: (
    rowData: Record<string, unknown>,
    index: number,
    offsetY?: number,
  ) => React.ReactNode;
}> = ({ visibleItems, rowHeight, containerHeight, onScroll, renderTableRow }) => (

    <Box
      onScroll={onScroll}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative' }}
    >
      <TableBody
        style={{
          height: visibleItems.totalHeight,
          position: 'relative' }}
      >
        {visibleItems.items.map((rowData, index) => 
          renderTableRow(rowData, visibleItems.startIndex + index, visibleItems.offsetY + index * rowHeight)
        )}
      </TableBody>
    </Box>
  
);

const PlainBody: React.FC<{
  data: TableBodyProps['data'];
  renderTableRow: (rowData: Record<string, unknown>, index: number) => React.ReactNode;
}> = ({ data, renderTableRow }) => (

    <TableBody>
      {data.map((rowData, index) => renderTableRow(rowData, index))}
    </TableBody>
);

// Enhanced Table Body Component  
export const EnhancedTableBody: React.FC<TableBodyProps> = React.memo(({
  data,
  columns,
  selectedRows = [],
  onRowClick,
  onRowFocus,
  onRowBlur,
  onSelectionChange,
  rowKeyExtractor,
  selectable,
  renderRow,
  renderCell,
  virtualScrolling,
  containerHeight,
  rowHeight,
  overscan = 5 }) => {
  const renderTableRow = useTableRowRenderer({
    columns,
    selectedRows,
    onRowClick,
    onRowFocus,
    onRowBlur,
    onSelectionChange,
    rowKeyExtractor,
    selectable,
    renderRow,
    renderCell,
    virtualScrolling,
    rowHeight });

  const { visibleItems, handleScroll } = useVirtualScrolling(
    data, 
    rowHeight || 40, 
    typeof containerHeight === 'number' ? containerHeight : 400, 
    overscan
  );

  if (virtualScrolling && containerHeight && rowHeight) {
    return (
      <VirtualisedBody
        visibleItems={visibleItems}
        rowHeight={rowHeight}
        containerHeight={containerHeight}
        onScroll={handleScroll}
        renderTableRow={renderTableRow}
      />
    );
  }

  return (
    <PlainBody data={data} renderTableRow={renderTableRow} />
  );
});

EnhancedTableBody.displayName = 'EnhancedTableBody';

// Main Table Component
