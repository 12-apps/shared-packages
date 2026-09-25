import Checkbox from '@mui/material/Checkbox/index.js';
import TableBody from '@mui/material/TableBody/index.js';
import TableCell from '@mui/material/TableCell/index.js';
import TableHead from '@mui/material/TableHead/index.js';
import TableRow from '@mui/material/TableRow/index.js';
import TableSortLabel from '@mui/material/TableSortLabel/index.js';
import { useTheme, type Theme } from '@mui/material/styles/index.js';
import React, { useCallback } from 'react';

import { rem } from '../../../tokens/relative';

import { tableRowHeight } from './Table.helpers';
import { useTableRowRenderer } from './TableParts.hooks';
import type { ColumnConfig, TableBodyProps, TableHeaderProps, VirtualWindow } from './Table.types';

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

/** A column's `width`/`minWidth` as CSS: a number is design px, a string as given. */
const columnLength = (theme: Theme, value: number | string | undefined): string | undefined =>
  typeof value === 'number' ? rem(theme, value) : value;

// One header cell. Sorting is offered when the table is sortable and the column
// has not opted out; aria-sort mirrors the visible indicator.
const HeaderCell: React.FC<{
  column: ColumnConfig;
  sortable?: boolean;
  sortConfig?: { key: string; direction: 'asc' | 'desc' };
  onSort: (columnKey: string) => void;
}> = ({ column, sortable, sortConfig, onSort }) => {
  const theme = useTheme();
  const canSort = Boolean(sortable) && column.sortable !== false;
  const isSorted = sortConfig?.key === column.key;

  return (
    <TableCell
      align={column.align || 'left'}
      style={{
        minWidth: columnLength(theme, column.minWidth),
        width: columnLength(theme, column.width),
      }}
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
  onSelectAll,
  headRef }) => {
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
    <TableHead ref={headRef}>
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
  /** Where a virtualised row sits, in design px — drawn through `rem`, like its height. */
  offsetY: number;
  columns: ColumnConfig[];
  selected: boolean;
  selectable?: boolean;
  /** Design px; 52 when unset (`tableRowHeight`). */
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
  renderCell }) => {
  const theme = useTheme();
  return (
      <TableRow
        key={String(rowKey)}
        selected={selected}
        className={selected ? 'selected' : ''}
        onClick={(event: React.MouseEvent<globalThis.HTMLTableRowElement>) => onRowClick?.(event, rowData)}
        onFocus={(event: React.FocusEvent<globalThis.HTMLTableRowElement>) => onRowFocus?.(event, rowData)}
        onBlur={(event: React.FocusEvent<globalThis.HTMLTableRowElement>) => onRowBlur?.(event, rowData)}
        style={virtualScrolling ? { 
          transform: `translateY(${rem(theme, offsetY)})`,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: rem(theme, tableRowHeight(rowHeight)) } : undefined}
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
};

// Only the rows in view are rendered, positioned by absolute offset inside a
// body sized to the full data set. `rowHeight` and every offset are design px,
// drawn through `rem`. The `<tbody>` sits directly in the `<table>`; the one
// scroll container wraps the whole table, header included (FUT-2658).
const VirtualisedBody: React.FC<{
  visibleItems: VirtualWindow;
  rowHeight: number;
  renderTableRow: (
    rowData: Record<string, unknown>,
    index: number,
    offsetY?: number,
  ) => React.ReactNode;
}> = ({ visibleItems, rowHeight, renderTableRow }) => (
  <TableBody
    style={{
      height: visibleItems.totalHeight,
      position: 'relative' }}
  >
    {visibleItems.items.map((rowData, index) => 
      renderTableRow(rowData, visibleItems.startIndex + index, visibleItems.offsetY + index * rowHeight)
    )}
  </TableBody>
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
export const EnhancedTableBody: React.FC<TableBodyProps> = React.memo((props) => {
  const { data, virtualWindow } = props;
  // The row renderer takes the body's own props; its `rowHeight` stays the
  // caller's design px, and the row resolves the default where it draws it.
  const renderTableRow = useTableRowRenderer({ ...props, selectedRows: props.selectedRows ?? [] });

  if (virtualWindow) {
    return (
      <VirtualisedBody
        visibleItems={virtualWindow}
        rowHeight={tableRowHeight(props.rowHeight)}
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
