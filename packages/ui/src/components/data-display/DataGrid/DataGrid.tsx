/**
 * `DataGrid` — the shell.
 *
 * Everything that is not "which of the four renders is this, and what wraps the
 * table" lives beside it: the state in `DataGrid.model.ts`, the client-mode row
 * pipeline in `DataGrid.rows.ts`, the cells and rows in `DataGrid.cells.tsx`,
 * the head/body in `DataGrid.body.tsx`, and the loading/error/empty renders in
 * `DataGrid.states.tsx`.
 *
 * All FOUR renders carry the caller's `data-testid`. It used to be applied only
 * on the populated one, so a grid whose first paint had no rows could not be
 * found by a test at all — see `DataGrid.states.tsx` for the full story.
 */
import { Paper, Table, TableContainer } from '@mui/material';
import type React from 'react';

import { GridBody, GridHeader } from './DataGrid.body';
import { useDataGridModel } from './DataGrid.model';
import { DataGridEmpty, DataGridError, DataGridLoading } from './DataGrid.states';
import type { DataGridProps } from './DataGrid.types';

/**
 * The chrome every render needs, with the defaults resolved ONCE.
 *
 * Extracted from the component body because a dozen destructuring defaults are
 * a dozen branches: the gate counted them, correctly, as complexity the render
 * did not need to carry.
 */
function resolveChrome<T extends Record<string, unknown>>(props: DataGridProps<T>): {
  dataAttrs: Record<string, unknown>;
  placeholder: {
    dataTestId?: string;
    ariaLabel: string;
    className?: string;
    style?: React.CSSProperties;
    htmlProps: React.HTMLAttributes<HTMLElement>;
  };
} {
  const { className, style, 'data-testid': dataTestId, ...rest } = props;
  const stickyHeader = props.stickyHeader ?? true;
  return {
    dataAttrs: {
      'data-ui': 'datagrid',
      'data-density': props.density ?? 'comfortable',
      'data-size-mode': props.sizeMode ?? 'auto',
      'data-virtual-rows': props.virtualizeRows ?? true,
      'data-virtual-cols': props.virtualizeColumns ?? false,
      'data-sticky-header': stickyHeader,
    },
    placeholder: {
      dataTestId,
      ariaLabel: props.ariaLabel ?? 'Data grid',
      className,
      style,
      // Only the DOM-safe leftovers reach the element: every grid-specific prop
      // is named in `GRID_ONLY_PROPS`, so this cannot smuggle `rows` onto a div.
      htmlProps: omitGridProps(rest as Record<string, unknown>),
    },
  };
}

export const DataGrid = <T extends Record<string, unknown> = Record<string, unknown>>(
  props: DataGridProps<T>,
): React.JSX.Element => {
  const model = useDataGridModel(props);
  const { dataAttrs, placeholder } = resolveChrome(props);

  if (props.loading) return <DataGridLoading {...placeholder} />;
  if (props.error) return <DataGridError {...placeholder} error={props.error} />;
  if (model.processedRows.length === 0) {
    return <DataGridEmpty {...placeholder} emptyState={props.emptyState} emptyText={props.emptyText} />;
  }

  const leadingColumns = (props.selection?.mode ?? 'none') !== 'none' ? 1 : 0;
  const totalColumns =
    model.visibleColumns.length + leadingColumns + (props.expansion ? 1 : 0);
  const section = { model, props, totalColumns };

  return (
    <Paper
      ref={model.containerRef}
      {...dataAttrs}
      data-testid={placeholder.dataTestId}
      className={placeholder.className}
      style={placeholder.style}
      role="grid"
      aria-label={placeholder.ariaLabel}
      aria-description={props.ariaDescription}
      aria-rowcount={model.processedRows.length + 1} // +1 for the header row
      aria-colcount={totalColumns}
      sx={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      {...placeholder.htmlProps}
    >
      <TableContainer
        sx={{ flex: 1, overflow: 'auto', position: 'relative' }}
        onScroll={model.onScroll}
      >
        <Table stickyHeader={props.stickyHeader ?? true}>
          <GridHeader {...section} />
          <GridBody {...section} />
        </Table>
      </TableContainer>
    </Paper>
  );
};

/**
 * The grid props that are NOT HTML attributes.
 *
 * `DataGridProps` extends `HTMLAttributes`, so the rest-spread carries the
 * grid's own configuration too. React would warn (or worse, serialize an array
 * of rows into an attribute) if any of it reached the DOM.
 */
const GRID_ONLY_PROPS = [
  'rows',
  'columns',
  'getRowId',
  'sizeMode',
  'density',
  'rowHeight',
  'headerHeight',
  'footerHeight',
  'selection',
  'pagination',
  'sorting',
  'filtering',
  'expansion',
  'editing',
  'virtualizeRows',
  'virtualizeColumns',
  'stickyHeader',
  'stickyFooter',
  'loading',
  'error',
  'emptyState',
  'onRequestData',
  'ariaLabel',
  'ariaDescription',
] as const;

function omitGridProps(rest: Record<string, unknown>): React.HTMLAttributes<HTMLElement> {
  const html: Record<string, unknown> = { ...rest };
  for (const key of GRID_ONLY_PROPS) delete html[key];
  return html as React.HTMLAttributes<HTMLElement>;
}

DataGrid.displayName = 'DataGrid';
