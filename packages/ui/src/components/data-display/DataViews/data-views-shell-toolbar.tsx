"use client";

/**
 * The toolbar band, fed from the controller — ~25 props of pure forwarding and
 * nothing else, which is why it lives in its own file rather than in the shell.
 */
import { type ColumnVisibilityOption } from "../../layout/ContentToolbar";

import type { DisplayPanelView } from "./data-views-display-panel";
import type { DataViewExport } from "./data-views-export";
import { GridToolbar } from "./data-views-toolbar";
import type { RowAction } from "./data-views-types";
import type { DataViewsController } from "./use-data-views-state";

/**
 * The toolbar band, fed from the controller. Split out of `GridShell` for that
 * function's size budget — it is ~25 props of pure forwarding and nothing else.
 */
export function ShellToolbar<T extends Record<string, unknown>>({
  c,
  rows,
  testIdPrefix,
  rowActions,
  bulkActions,
  toolbarRightSlot,
  showInline,
  compactControls,
  counterHidden,
  sortKinds,
  displayView,
  exportConfig,
  filterControls,
  barRef,
}: {
  c: DataViewsController<T>;
  rows: T[];
  testIdPrefix: string;
  sortKinds?: Record<string, string>;
  displayView?: DisplayPanelView;
  exportConfig?: DataViewExport;
  rowActions?: RowAction<T>[];
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  toolbarRightSlot?: React.ReactNode;
  /** Search + filters, rendered on the toolbar line (see `GridToolbar`). */
  filterControls?: React.ReactNode;
  barRef?: React.Ref<HTMLDivElement>;
  showInline: boolean;
  /** Step 2 of the ladder: Exibir/Exportar as icons only. */
  compactControls?: boolean;
  /** Step 5, last resort: drop the counter so the row still fits one line. */
  counterHidden?: boolean;
}): React.JSX.Element {
  const columnOptions: ColumnVisibilityOption[] = c.hideableColumns.map((col) => ({
    id: col.id,
    label: col.label,
    visible: c.state.visibleColumns.includes(col.id),
  }));
  return (
    <GridToolbar
      c={c}
      sortKinds={sortKinds}
      displayView={displayView}
      exportConfig={exportConfig}
      filterControls={filterControls}
      barRef={barRef}
      compactControls={compactControls}
      counterHidden={counterHidden}
      testIdPrefix={testIdPrefix}
      selectedRows={c.selectedRows}
      selectAll={c.selectAll}
      clearSelection={c.clearSelection}
      rowActions={rowActions}
      bulkActions={bulkActions}
      sortFields={c.resolvedSortFields}
      activeSortField={c.activeSortField}
      activeSortOrder={c.activeSortOrder}
      onChangeSort={(field, order) => c.patch({ sortBy: [{ id: field, dir: order }] })}
      matchedCount={c.matched.length}
      totalCount={c.serverMode ? c.serverTotalCount : rows.length}
      toolbarRightSlot={toolbarRightSlot}
      columnOptions={columnOptions}
      onToggleColumn={c.toggleColumn}
      filterOpen={c.filterOpen}
      setFilterOpen={c.setFilterOpen}
      activeFilterCount={c.activeFilterCount}
      showFilterTrigger={!showInline}
    />
  );
}

/** Wires the controller into the shared toolbar + filter panel + grid/cards body. */
