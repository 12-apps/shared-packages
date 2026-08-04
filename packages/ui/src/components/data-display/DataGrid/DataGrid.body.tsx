/**
 * The DataGrid's `<thead>` and `<tbody>`.
 *
 * Split from the shell so each stays inside the size budget and so the
 * virtualization spacers — which are pure layout, not data — sit next to the
 * rows they pad rather than in the middle of the component that owns the paper.
 */
import { Checkbox, TableBody, TableCell, TableHead, TableRow, useTheme } from '@mui/material';
import type React from 'react';

import { GridRow, HeaderCell } from './DataGrid.cells';
import type { DataGridModel } from './DataGrid.model';
import type { DataGridProps } from './DataGrid.types';

export interface GridSectionProps<T extends Record<string, unknown>> {
  model: DataGridModel<T>;
  props: DataGridProps<T>;
  totalColumns: number;
}

/** The leading header cells for the selection / expansion columns. */
function HeaderControls<T extends Record<string, unknown>>({
  model,
  props,
}: GridSectionProps<T>): React.JSX.Element {
  const theme = useTheme();
  const { selection = { mode: 'none' }, expansion, stickyHeader = true } = props;
  const sticky = {
    position: stickyHeader ? ('sticky' as const) : ('static' as const),
    top: 0,
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
  };
  const total = model.processedRows.length;
  const picked = model.selectedRowIds.length;
  return (
    <>
      {selection.mode !== 'none' && (
        <TableCell padding="checkbox" sx={sticky}>
          {selection.mode === 'multi' && (
            <Checkbox
              indeterminate={picked > 0 && picked < total}
              checked={total > 0 && picked === total}
              onChange={(event) =>
                model.setSelectedRowIds(
                  event.target.checked
                    ? model.processedRows.map((row, index) => rowIdOf(props, row, index))
                    : [],
                )
              }
              inputProps={{ 'aria-label': 'Select all rows' }}
            />
          )}
        </TableCell>
      )}
      {expansion && <TableCell padding="checkbox" sx={sticky} />}
    </>
  );
}

/** The caller's `getRowId`, or the row's own `id`, or its index. */
export function rowIdOf<T extends Record<string, unknown>>(
  props: DataGridProps<T>,
  row: T,
  index: number,
): string | number {
  if (props.getRowId) return props.getRowId(row, index);
  const candidate = (row as { id?: string | number }).id;
  return candidate ?? index;
}

export function GridHeader<T extends Record<string, unknown>>(
  section: GridSectionProps<T>,
): React.JSX.Element {
  const { model, props } = section;
  const { sorting = {}, stickyHeader = true, headerHeight = 56 } = props;
  const sortable = sorting.mode === 'client' || sorting.mode === 'server';
  return (
    <TableHead data-slot="header">
      <TableRow data-slot="header-row" role="row">
        <HeaderControls {...section} />
        {model.visibleColumns.map((column) => (
          <HeaderCell
            key={column.id}
            column={column}
            sort={model.sortBy.find((entry) => entry.id === column.id)}
            sortable={column.enableSort !== false && sortable}
            stickyHeader={stickyHeader}
            headerHeight={headerHeight}
            onSort={model.onSort}
          />
        ))}
      </TableRow>
    </TableHead>
  );
}

/** An invisible row standing in for the rows the window is not rendering. */
function Spacer({ height, colSpan }: { height: number; colSpan: number }): React.JSX.Element | null {
  if (height <= 0) return null;
  return (
    <TableRow>
      <TableCell colSpan={colSpan} sx={{ height, border: 'none', p: 0 }} />
    </TableRow>
  );
}

export function GridBody<T extends Record<string, unknown>>(
  section: GridSectionProps<T>,
): React.JSX.Element {
  const { model, props, totalColumns } = section;
  const { start, end } = model.visibleRange;
  const trailing = model.virtualized ? model.processedRows.length - end : 0;
  return (
    <TableBody data-slot="body">
      {model.virtualized ? (
        <Spacer height={start * model.rowHeight} colSpan={totalColumns} />
      ) : null}
      {model.visibleRows.map((row, offset) => {
        const index = model.virtualized ? start + offset : offset;
        const rowId = rowIdOf(props, row, index);
        return (
          <GridRow
            key={rowId}
            row={row}
            index={index}
            rowId={rowId}
            isSelected={model.selectedRowIdsSet.has(rowId)}
            isExpanded={model.expandedRowIdsSet.has(rowId)}
            totalColumns={totalColumns}
            model={model}
            props={props}
          />
        );
      })}
      {model.virtualized ? (
        <Spacer height={trailing * model.rowHeight} colSpan={totalColumns} />
      ) : null}
    </TableBody>
  );
}
