/**
 * The DataGrid's cell and row renderers.
 *
 * Components rather than closures over the grid's scope: as inline `render*`
 * functions they could reach every piece of the component's state, which is how
 * the body grew past 700 lines. Each one now states exactly what it needs.
 */
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import UnfoldMore from '@mui/icons-material/UnfoldMore';
import { Button, Checkbox, IconButton, TableCell, TableRow, Typography, useTheme } from '@mui/material';
import React from 'react';

import { cellValue } from './DataGrid.rows';
import type { DataGridModel } from './DataGrid.model';
import type { DataGridProps, GridColumn, GridSort } from './DataGrid.types';

/** The glyph for a column's current sort state — unsorted included. */
function SortIcon({ dir }: { dir: GridSort['dir'] | undefined }): React.JSX.Element {
  if (!dir) return <UnfoldMore fontSize="small" sx={{ opacity: 0.5 }} />;
  return dir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />;
}

/** `aria-sort`'s three values, which are not the same words as `SortDirection`. */
function ariaSort(dir: GridSort['dir'] | undefined): 'none' | 'ascending' | 'descending' {
  if (!dir) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}

export interface HeaderCellProps<T extends Record<string, unknown>> {
  column: GridColumn<T>;
  sort: GridSort | undefined;
  sortable: boolean;
  stickyHeader: boolean;
  headerHeight: number;
  onSort: (columnId: string) => void;
}

export function HeaderCell<T extends Record<string, unknown>>({
  column,
  sort,
  sortable,
  stickyHeader,
  headerHeight,
  onSort,
}: HeaderCellProps<T>): React.JSX.Element {
  const theme = useTheme();
  const content = column.headerCell ? column.headerCell(column) : column.header;
  return (
    <TableCell
      data-slot="header-cell"
      data-sort={sort?.dir ?? 'none'}
      sx={{
        position: stickyHeader ? 'sticky' : 'static',
        top: 0,
        zIndex: 1,
        backgroundColor: theme.palette.background.paper,
        borderBottom: `1px solid ${theme.palette.divider}`,
        height: headerHeight,
        minWidth: column.minWidth,
        maxWidth: column.maxWidth,
        width: column.width,
      }}
      role="columnheader"
      aria-sort={ariaSort(sort?.dir)}
    >
      {sortable ? (
        <Button
          onClick={() => onSort(column.id)}
          sx={{
            justifyContent: 'flex-start',
            textTransform: 'none',
            fontWeight: 500,
            color: 'inherit',
            p: 0,
            minWidth: 0,
            '&:hover': { backgroundColor: 'transparent', opacity: 0.8 },
          }}
          endIcon={<SortIcon dir={sort?.dir} />}
          aria-label={column.ariaLabel ?? `Sort by ${String(column.header)}`}
        >
          {content}
        </Button>
      ) : (
        <Typography variant="subtitle2" fontWeight={500}>
          {content}
        </Typography>
      )}
    </TableCell>
  );
}

export interface DataCellProps<T extends Record<string, unknown>> {
  row: T;
  rowIndex: number;
  rowId: string | number;
  column: GridColumn<T>;
  rowHeight: number;
  editing: NonNullable<DataGridProps<T>['editing']>;
  model: Pick<DataGridModel<T>, 'editingCell' | 'setEditingCell'>;
}

export function DataCell<T extends Record<string, unknown>>({
  row,
  rowIndex,
  rowId,
  column,
  rowHeight,
  editing,
  model,
}: DataCellProps<T>): React.JSX.Element {
  const value = cellValue(row, column);
  const isEditing =
    model.editingCell?.rowId === rowId && model.editingCell?.colId === column.id;
  const content = column.cell
    ? column.cell({ value, row, rowIndex, col: column })
    : String(value ?? '');
  return (
    <TableCell
      data-slot="cell"
      data-col-id={column.id}
      data-editing={isEditing}
      sx={{
        minWidth: column.minWidth,
        maxWidth: column.maxWidth,
        width: column.width,
        height: rowHeight,
      }}
      role="gridcell"
      tabIndex={-1}
    >
      {isEditing && column.editor
        ? column.editor({
            value,
            row,
            onChange: () => undefined,
            commit: () => {
              editing.onEditCommit?.({ rowId, colId: column.id, value, row });
              model.setEditingCell(null);
            },
            cancel: () => model.setEditingCell(null),
          })
        : content}
    </TableCell>
  );
}

export interface GridRowProps<T extends Record<string, unknown>> {
  row: T;
  index: number;
  rowId: string | number;
  isSelected: boolean;
  isExpanded: boolean;
  totalColumns: number;
  model: DataGridModel<T>;
  props: DataGridProps<T>;
}

/** The leading checkbox / chevron cells, which exist only for enabled features. */
function RowControls<T extends Record<string, unknown>>({
  index,
  rowId,
  isSelected,
  isExpanded,
  model,
  props,
}: GridRowProps<T>): React.JSX.Element {
  const { selection = { mode: 'none' }, expansion } = props;
  return (
    <>
      {selection.mode !== 'none' && (
        <TableCell padding="checkbox">
          <Checkbox
            checked={isSelected}
            onChange={(event) => model.onToggleRow(rowId, event.target.checked)}
            inputProps={{ 'aria-label': `Select row ${index + 1}` }}
          />
        </TableCell>
      )}
      {expansion && (
        <TableCell padding="checkbox">
          <IconButton
            size="small"
            onClick={() => model.onToggleExpansion(rowId)}
            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
          >
            {isExpanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </TableCell>
      )}
    </>
  );
}

export function GridRow<T extends Record<string, unknown>>(
  rowProps: GridRowProps<T>,
): React.JSX.Element {
  const { row, index, rowId, isSelected, isExpanded, totalColumns, model, props } = rowProps;
  const theme = useTheme();
  const expansion = props.expansion;
  return (
    <React.Fragment>
      <TableRow
        data-slot="row"
        data-selected={isSelected}
        data-expanded={isExpanded}
        sx={{
          '&:hover': { backgroundColor: theme.palette.action.hover },
          ...(isSelected && { backgroundColor: theme.palette.action.selected }),
          height: model.rowHeight,
        }}
        role="row"
        aria-selected={isSelected}
      >
        <RowControls {...rowProps} />
        {model.visibleColumns.map((column) => (
          <DataCell
            key={column.id}
            row={row}
            rowIndex={index}
            rowId={rowId}
            column={column}
            rowHeight={model.rowHeight}
            editing={props.editing ?? { mode: 'none' }}
            model={model}
          />
        ))}
      </TableRow>
      {expansion && isExpanded && (
        <TableRow>
          <TableCell colSpan={totalColumns}>{expansion.render(row, index)}</TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}
