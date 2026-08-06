"use client";

import { useMemo } from "react";

import { type GridColumn } from "../DataGrid";

import {
  buildGridColumns,
  buildRowActionsColumn,
  isActionsColumn,
} from "./data-views-grid-helpers";
import type { DataViewColumn, RowAction } from "./data-views-types";

/**
 * Every column derivation the DataViews grid needs, in one place: the auto kebab
 * actions column, the id list that seeds a pristine view state, what the grid
 * actually renders once visibility is applied, and the show/hide menu's list.
 */

/** A column the user may show/hide via the toolbar's ColumnsMenu. */
export interface HideableColumn {
  id: string;
  label: string;
}

/**
 * The columns the user may show/hide: explicitly hideable (not `hideable:false`,
 * which marks structural columns like the image thumbnail or actions kebab) and
 * carrying a text header to label the checkbox.
 */
function computeHideableColumns<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
): HideableColumn[] {
  return columns
    .filter((col) => col.hideable !== false && typeof col.header === "string" && col.header !== "")
    .map((col) => ({ id: col.id, label: col.header as string }));
}

/**
 * Append the auto kebab actions column unless the page already defines one. The
 * column is added when there are `rowActions` OR a bespoke `renderRowMenu` (an
 * entity's self-contained menu that owns its own popups).
 */
function appendActionsColumn<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
  opts: {
    rowActions?: RowAction<T>[];
    rowActionsLeading?: (row: T) => React.ReactNode;
    renderRowMenu?: (row: T) => React.ReactNode;
    testIdPrefix: string;
    getRowId: (row: T) => string | number;
  },
): DataViewColumn<T>[] {
  const { rowActions, rowActionsLeading, renderRowMenu, testIdPrefix, getRowId } = opts;
  if ((!rowActions && !renderRowMenu) || columns.some(isActionsColumn)) return columns;
  return [
    ...columns,
    buildRowActionsColumn({
      rowActions: rowActions ?? [],
      leading: rowActionsLeading,
      testIdPrefix,
      getRowId,
      renderRowMenu,
    }),
  ];
}

/** Options {@link appendActionsColumn} needs to build the auto kebab column. */
type ActionsColumnOpts<T extends Record<string, unknown>> = {
  rowActions?: RowAction<T>[];
  rowActionsLeading?: (row: T) => React.ReactNode;
  renderRowMenu?: (row: T) => React.ReactNode;
  testIdPrefix: string;
  getRowId: (row: T) => string | number;
};

/**
 * The declared columns plus the auto kebab column (unless the page defines its
 * own), and every column id — which is what seeds a pristine view state's
 * `visibleColumns`, so it is derived BEFORE the state exists.
 */
export function useColumnsWithActions<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
  opts: ActionsColumnOpts<T>,
): { columnsWithActions: DataViewColumn<T>[]; allColumnIds: string[] } {
  const { rowActions, rowActionsLeading, renderRowMenu, testIdPrefix, getRowId } = opts;
  const columnsWithActions = useMemo(
    () =>
      appendActionsColumn(columns, { rowActions, rowActionsLeading, renderRowMenu, testIdPrefix, getRowId }),
    [columns, rowActions, rowActionsLeading, renderRowMenu, testIdPrefix, getRowId],
  );
  const allColumnIds = useMemo(() => columnsWithActions.map((col) => col.id), [columnsWithActions]);
  return { columnsWithActions, allColumnIds };
}

/** What the grid actually renders: visibility applied, plus the show/hide menu's list. */
export function useRenderedColumns<T extends Record<string, unknown>>(
  columnsWithActions: DataViewColumn<T>[],
  visibleColumns: string[],
  onRowClick: ((row: T) => void) | undefined,
): { gridColumns: GridColumn<T>[]; hideableColumns: HideableColumn[] } {
  const gridColumns = useMemo(
    () => buildGridColumns(columnsWithActions, visibleColumns, onRowClick),
    [columnsWithActions, onRowClick, visibleColumns],
  );
  const hideableColumns = useMemo(() => computeHideableColumns(columnsWithActions), [columnsWithActions]);
  return { gridColumns, hideableColumns };
}

