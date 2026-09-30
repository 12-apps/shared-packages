import type React from 'react';
import { useCallback } from 'react';

import { TableDataRow } from './TableParts';
import type { TableBodyProps } from './Table.types';

// Row identity, selection and the row element itself. Split out of
// EnhancedTableBody so that component is just the virtualised/plain choice.
// A row's identity: the caller's extractor, else its id, else its position.
const useRowKey = (rowKeyExtractor: TableBodyProps['rowKeyExtractor']) =>
  useCallback(
    (rowData: Record<string, unknown>, index: number): string | number =>
      rowKeyExtractor ? rowKeyExtractor(rowData, index) : (rowData.id as string | number) || index,
    [rowKeyExtractor],
  );

const useRowSelection = ({
  selectedRows,
  onSelectionChange,
}: {
  selectedRows: Array<string | number>;
  onSelectionChange: TableBodyProps['onSelectionChange'];
}) =>
  useCallback(
    (event: React.MouseEvent | React.ChangeEvent, rowKey: string | number) => {
      // Stop propagation so selecting does not also fire the row click.
      event.stopPropagation();
      if (!onSelectionChange) return;
      onSelectionChange(rowKey, !selectedRows.includes(rowKey));
    },
    [onSelectionChange, selectedRows],
  );

type RowRendererProps = Pick<
  TableBodyProps,
  | 'columns'
  | 'onRowClick'
  | 'onRowFocus'
  | 'onRowBlur'
  | 'onSelectionChange'
  | 'rowKeyExtractor'
  | 'selectable'
  | 'renderRow'
  | 'renderCell'
  | 'rowHeight'
> & {
  selectedRows: Array<string | number>;
  /** Whether the rows are a virtual window's, drawn at exactly `rowHeight`. */
  virtualised: boolean;
};

export const useTableRowRenderer = ({
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
  virtualised,
  rowHeight,
}: RowRendererProps) => {
  const getRowKey = useRowKey(rowKeyExtractor);
  const isRowSelected = useCallback(
    (rowKey: string | number) => selectedRows.includes(rowKey),
    [selectedRows],
  );
  const handleRowSelection = useRowSelection({ selectedRows, onSelectionChange });

  const renderTableRow = useCallback(
    (rowData: Record<string, unknown>, index: number) => {
      const rowKey = getRowKey(rowData, index);
      const selected = isRowSelected(rowKey);

      if (renderRow) return renderRow(rowData, index, selected);

      return (
        <TableDataRow
          key={rowKey}
          rowData={rowData}
          rowKey={rowKey}
          index={index}
          columns={columns}
          selected={selected}
          selectable={selectable}
          rowHeight={rowHeight}
          onRowClick={onRowClick}
          onRowFocus={onRowFocus}
          onRowBlur={onRowBlur}
          onSelect={handleRowSelection}
          virtualised={virtualised}
          renderCell={renderCell}
        />
      );
    },
    [
      columns,
      getRowKey,
      isRowSelected,
      handleRowSelection,
      onRowClick,
      onRowFocus,
      onRowBlur,
      renderRow,
      renderCell,
      rowHeight,
      selectable,
      virtualised,
    ],
  );

  return renderTableRow;
};
