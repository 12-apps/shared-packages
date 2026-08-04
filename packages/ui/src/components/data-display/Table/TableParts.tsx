import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRight from '@mui/icons-material/KeyboardArrowRight';
import {
  Box,
  Checkbox,
  CircularProgress,
  Collapse,
  IconButton,
  Skeleton,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import React, { useCallback, useMemo, useState } from 'react';

import { getDensityConfig } from './Table.styles';
import { useVirtualScrolling } from './Table.hooks';
import type { ColumnConfig, TableBodyProps, TableHeaderProps } from './Table.types';

export const EnhancedTableHeader: React.FC<TableHeaderProps> = React.memo(({
  columns,
  data,
  sortable,
  sortConfig,
  onSortChange,
  selectable,
  selectedRows = [],
  onSelectAll,
}) => {
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
          <TableCell
            key={column.key}
            align={column.align || 'left'}
            style={{ 
              minWidth: column.minWidth,
              width: column.width,
            }}
            aria-sort={
              sortable && column.sortable !== false && sortConfig?.key === column.key
                ? sortConfig.direction === 'asc' ? 'ascending' : 'descending'
                : undefined
            }
          >
            {sortable && column.sortable !== false ? (
              <TableSortLabel
                active={sortConfig?.key === column.key}
                direction={sortConfig?.key === column.key ? sortConfig.direction : 'asc'}
                onClick={() => handleSort(column.key)}
                data-testid="sort-indicator"
                aria-label={`Sort by ${column.label}`}
              >
                {column.label}
              </TableSortLabel>
            ) : (
              column.label
            )}
          </TableCell>
        ))}
      </TableRow>
    </TableHead>
  );
});

EnhancedTableHeader.displayName = 'EnhancedTableHeader';

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
  overscan = 5,
}) => {
  const getRowKey = useCallback(
    (rowData: Record<string, unknown>, index: number): string | number => rowKeyExtractor ? rowKeyExtractor(rowData, index) : (rowData.id as string | number) || index,
    [rowKeyExtractor]
  );

  const isRowSelected = useCallback(
    (rowKey: string | number) => selectedRows.includes(rowKey),
    [selectedRows]
  );

  const handleRowSelection = useCallback(
    (event: React.MouseEvent | React.ChangeEvent, rowKey: string | number) => {
      // Stop propagation to prevent row click conflict
      event.stopPropagation();
      if (!onSelectionChange) return;
      const isSelected = selectedRows.includes(rowKey);
      onSelectionChange(rowKey, !isSelected);
    },
    [onSelectionChange, selectedRows]
  );

  const renderTableRow = useCallback((rowData: Record<string, unknown>, index: number, offsetY: number = 0) => {
    const rowKey = getRowKey(rowData, index);
    const selected = isRowSelected(rowKey);

    if (renderRow) {
      return renderRow(rowData, index, selected);
    }

    return (
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
          height: rowHeight,
        } : undefined}
      >
        {selectable && (
          <TableCell padding="checkbox">
            <Checkbox
              checked={selected}
              onChange={(event) => handleRowSelection(event, rowKey)}
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
  }, [getRowKey, isRowSelected, renderRow, renderCell, columns, selectable, handleRowSelection, onRowClick, onRowFocus, onRowBlur, virtualScrolling, rowHeight]);

  const { visibleItems, handleScroll } = useVirtualScrolling(
    data, 
    rowHeight || 40, 
    typeof containerHeight === 'number' ? containerHeight : 400, 
    overscan
  );

  if (virtualScrolling && containerHeight && rowHeight) {

    return (
      <Box
        onScroll={handleScroll}
        style={{
          height: containerHeight,
          overflow: 'auto',
          position: 'relative',
        }}
      >
        <TableBody
          style={{
            height: visibleItems.totalHeight,
            position: 'relative',
          }}
        >
          {visibleItems.items.map((rowData, index) => 
            renderTableRow(rowData, visibleItems.startIndex + index, visibleItems.offsetY + index * rowHeight)
          )}
        </TableBody>
      </Box>
    );
  }

  return (
    <TableBody>
      {data.map((rowData, index) => renderTableRow(rowData, index))}
    </TableBody>
  );
});

EnhancedTableBody.displayName = 'EnhancedTableBody';

// Main Table Component
