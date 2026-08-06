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

/**
 * Apply a stored column ORDER, tolerantly.
 *
 * A stored list goes stale in both directions and neither may lose a column: an
 * id the table no longer declares is dropped, and a column the table declares
 * but the list never mentioned (added since the view was saved) falls in AFTER
 * the ordered ones rather than vanishing. Absent order ⇒ declaration order.
 */
function applyOrder<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
  order: string[] | undefined,
): DataViewColumn<T>[] {
  if (!order || order.length === 0) return columns;
  const byId = new Map(columns.map((column) => [column.id, column]));
  const ordered = order.map((id) => byId.get(id)).filter((c): c is DataViewColumn<T> => Boolean(c));
  const seen = new Set(ordered.map((column) => column.id));
  return [...ordered, ...columns.filter((column) => !seen.has(column.id))];
}

/** What the grid actually renders: order + visibility applied, plus the menu's list. */
export function useRenderedColumns<T extends Record<string, unknown>>(
  columnsWithActions: DataViewColumn<T>[],
  visibleColumns: string[],
  onRowClick: ((row: T) => void) | undefined,
  order?: string[],
): { gridColumns: GridColumn<T>[]; hideableColumns: HideableColumn[] } {
  const gridColumns = useMemo(
    () => buildGridColumns(applyOrder(columnsWithActions, order), visibleColumns, onRowClick),
    [columnsWithActions, onRowClick, visibleColumns, order],
  );
  const hideableColumns = useMemo(() => computeHideableColumns(columnsWithActions), [columnsWithActions]);
  return { gridColumns, hideableColumns };
}

