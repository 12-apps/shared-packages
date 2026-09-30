import Checkbox from '@mui/material/Checkbox/index.js';
import TableBody from '@mui/material/TableBody/index.js';
import TableCell from '@mui/material/TableCell/index.js';
import TableHead from '@mui/material/TableHead/index.js';
import TableRow from '@mui/material/TableRow/index.js';
import TableSortLabel from '@mui/material/TableSortLabel/index.js';
import { useTheme, type Theme } from '@mui/material/styles/index.js';
import React, { useCallback } from 'react';

import { FIELD_BORDER_WIDTH } from '../../../tokens/field-height.core';
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

/** How a virtual cell's wrapper places its content along the row, per `align`. */
const JUSTIFY: Record<NonNullable<ColumnConfig['align']>, React.CSSProperties['justifyContent']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

/**
 * A virtual cell's content (FUT-2668). The cell has no vertical padding, and
 * this fills its content box — the pitch less the cell's bottom rule, the one
 * hairline every variant draws — so the cell's border box is exactly the pitch
 * whatever it holds. Centred vertically, placed by the column's `align`, and
 * clipped rather than allowed to grow the row.
 */
const VirtualCellContent: React.FC<{
  rowHeight: number;
  align: NonNullable<ColumnConfig['align']>;
  children: React.ReactNode;
}> = ({ rowHeight, align, children }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        height: `calc(${rem(theme, rowHeight)} - ${FIELD_BORDER_WIDTH}px)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: JUSTIFY[align],
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
};

/** What one cell shows: the caller's `renderCell`, else the column's `render`, else the value. */
const cellContent = (
  column: ColumnConfig,
  rowData: Record<string, unknown>,
  index: number,
  renderCell: TableBodyProps['renderCell'],
): React.ReactNode => {
  const value = rowData[column.key];
  if (renderCell) return renderCell(value, column, rowData, index);
  return column.render ? column.render(value, rowData) : (value as React.ReactNode);
};

// One data row. Split out of the memoised renderTableRow callback so the
// callback stays a short dispatch and the row markup is readable on its own.
// A virtualised row stays in the table's flow at `rowHeight`, and each of its
// cells holds its content in a `VirtualCellContent` (FUT-2668); a plain row is
// drawn as MUI draws it.
export const TableDataRow: React.FC<{
  rowData: Record<string, unknown>;
  rowKey: string | number;
  index: number;
  columns: ColumnConfig[];
  selected: boolean;
  selectable?: boolean;
  /** Design px; 52 when unset (`tableRowHeight`). */
  rowHeight?: number;
  onRowClick?: TableBodyProps['onRowClick'];
  onRowFocus?: TableBodyProps['onRowFocus'];
  onRowBlur?: TableBodyProps['onRowBlur'];
  onSelect: (event: React.MouseEvent | React.ChangeEvent, rowKey: string | number) => void;
  /** Whether the row is one of a virtual window's. */
  virtualised: boolean;
  renderCell?: TableBodyProps['renderCell'];
}> = ({
  rowData,
  rowKey,
  index,
  columns,
  selected,
  selectable,
  rowHeight,
  onRowClick,
  onRowFocus,
  onRowBlur,
  onSelect,
  virtualised,
  renderCell }) => {
  const theme = useTheme();
  const pitch = tableRowHeight(rowHeight);
  const fit = (align: NonNullable<ColumnConfig['align']>, content: React.ReactNode) =>
    virtualised ? (
      <VirtualCellContent rowHeight={pitch} align={align}>
        {content}
      </VirtualCellContent>
    ) : (
      content
    );

  return (
      <TableRow
        key={String(rowKey)}
        selected={selected}
        className={selected ? 'selected' : ''}
        onClick={(event: React.MouseEvent<globalThis.HTMLTableRowElement>) => onRowClick?.(event, rowData)}
        onFocus={(event: React.FocusEvent<globalThis.HTMLTableRowElement>) => onRowFocus?.(event, rowData)}
        onBlur={(event: React.FocusEvent<globalThis.HTMLTableRowElement>) => onRowBlur?.(event, rowData)}
        style={virtualised ? { height: rem(theme, pitch) } : undefined}
      >
        {selectable && (
          <TableCell padding="checkbox">
            {fit(
              'left',
              <Checkbox
                checked={selected}
                onChange={(event) => onSelect(event, rowKey)}
                onClick={(event) => event.stopPropagation()}
                inputProps={{ 'aria-label': `select row ${index + 1}` }}
              />,
            )}
          </TableCell>
        )}
        {columns.map((column) => (
          <TableCell key={column.key} align={column.align || 'left'}>
            {fit(column.align || 'left', cellContent(column, rowData, index, renderCell))}
          </TableCell>
        ))}
      </TableRow>
  );
};

/**
 * A stand-in for the rows outside the window, `heightPx` design px tall. A bare
 * `<tr>` and `<td>` with no padding or border: none of MUI's row or cell
 * classes, so hover, striping and cell padding never reach it. Not rendered at
 * all when there is nothing to stand in for.
 */
const SpacerRow: React.FC<{ heightPx: number; colSpan: number }> = ({ heightPx, colSpan }) => {
  const theme = useTheme();
  if (heightPx <= 0) return null;
  return (
    <tr aria-hidden="true" style={{ height: rem(theme, heightPx) }}>
      <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
    </tr>
  );
};

// Only the rows in view are rendered, in the table's own flow between two
// spacer rows standing in for the rest (FUT-2668) — an absolutely positioned
// `<tr>` is blockified and leaves the column grid. Every height is design px,
// drawn through `rem`. The `<tbody>` sits directly in the `<table>`; the one
// scroll container wraps the whole table, header included (FUT-2658).
const VirtualisedBody: React.FC<{
  visibleItems: VirtualWindow;
  colSpan: number;
  renderTableRow: (rowData: Record<string, unknown>, index: number) => React.ReactNode;
}> = ({ visibleItems, colSpan, renderTableRow }) => (
  <TableBody>
    <SpacerRow heightPx={visibleItems.offsetY} colSpan={colSpan} />
    {visibleItems.items.map((rowData, index) =>
      renderTableRow(rowData, visibleItems.startIndex + index)
    )}
    <SpacerRow heightPx={visibleItems.trailingPx} colSpan={colSpan} />
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
  const renderTableRow = useTableRowRenderer({
    ...props,
    selectedRows: props.selectedRows ?? [],
    virtualised: Boolean(virtualWindow),
  });

  if (virtualWindow) {
    return (
      <VirtualisedBody
        visibleItems={virtualWindow}
        colSpan={props.columns.length + (props.selectable ? 1 : 0)}
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
