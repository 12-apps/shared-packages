"use client";

import { Divider } from "@mui/material";

import {
  ContentToolbar,
  FilterTrigger,
  type ColumnVisibilityOption,
  type SortFieldDefinition,
} from "../../layout/ContentToolbar";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { useDataViewsCopy } from "./data-views-copy-context";
import { DataViewsDisplayPanel, type DisplayPanelView } from "./data-views-display-panel";
import { DataViewsExportMenu, type DataViewExport } from "./data-views-export";
import { renderBulkActions } from "./data-views-grid-helpers";
import type { RowAction } from "./data-views-types";
import type { DataViewsController } from "./use-data-views-state";

export interface GridToolbarProps<T extends Record<string, unknown>> {
  testIdPrefix: string;
  selectedRows: T[];
  selectAll: () => void;
  clearSelection: () => void;
  rowActions?: RowAction<T>[];
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  sortFields: SortFieldDefinition[];
  activeSortField: string;
  activeSortOrder: "asc" | "desc";
  onChangeSort: (field: string, order: "asc" | "desc") => void;
  matchedCount: number;
  totalCount: number;
  toolbarRightSlot?: React.ReactNode;
  columnOptions: ColumnVisibilityOption[];
  onToggleColumn: (id: string, visible: boolean) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  activeFilterCount: number;
  /** Hide the "Filtros" slide-in trigger (compact layout shows filters inline). */
  showFilterTrigger?: boolean;
  /**
   * Search + filter controls, rendered ON the toolbar line rather than on a row
   * beneath it. Absent ⇒ the toolbar keeps its plain two-cluster shape.
   */
  filterControls?: React.ReactNode;
  /** Measures the toolbar ROW for the filter overflow — see `useFilterOverflow`. */
  barRef?: React.Ref<HTMLDivElement>;
  /** The controller, so "Exibir" can drive sort, columns, order and format. */
  c: DataViewsController<T>;
  /** Per-sort-field value kind, so directions read in the column's own terms. */
  sortKinds?: Record<string, string>;
  /** The saved-view chrome bracketing the Exibir panel, when the host has views. */
  displayView?: DisplayPanelView;
  /** Injected export. Absent ⇒ no Exportar control. */
  exportConfig?: DataViewExport;
  /**
   * Step 2 of the degradation ladder: Exibir/Exportar as icons only.
   * MEASURED upstream (see `useFilterOverflow`) rather than switched at a
   * breakpoint, so a two-filter page keeps its labels where a five-filter one
   * has already given them up.
   */
  compactControls?: boolean;
  /**
   * Step 5 of the ladder, and its floor: on a screen too narrow for even the
   * fully-collapsed row, the counter is dropped so the controls still fit one
   * line instead of spilling outside the toolbar.
   */
  counterHidden?: boolean;
}

/** The right-aligned toolbar controls: Sort By, the counter, zoom/layout/columns, filters. */
function ToolbarRightControls<T extends Record<string, unknown>>(props: GridToolbarProps<T>): React.JSX.Element {
  const { testIdPrefix, matchedCount, totalCount, filterOpen, setFilterOpen } = props;
  return (
    <>
      {/* MEASURED, never breakpointed: `RESERVED.counter` prices it into the
          ladder, so hiding it at `md` was the ladder and a breakpoint
          disagreeing about the same pixels — which broke the row at exactly
          900px. It is dropped only as the ladder's last rung. */}
      {!props.counterHidden && (
        <>
          <Text variant="caption" as="span">
            <Box
              component="span"
              data-testid={`${testIdPrefix}-counter`}
              sx={{ whiteSpace: "nowrap" }}
            >
              {matchedCount} de {totalCount}
            </Box>
          </Text>
          {/* Divides the READING of the list from the controls that change it —
              the counter states what is on screen, everything right of here
              acts on it. */}
          <Divider
            orientation="vertical"
            flexItem
            sx={{ height: 20, alignSelf: "center", mx: 0.5 }}
          />
        </>
      )}
      {props.toolbarRightSlot}
      {/* Sort + columns + format, in ONE control — see DataViewsDisplayPanel. */}
      <DataViewsDisplayPanel
        c={props.c}
        testIdPrefix={testIdPrefix}
        sortKinds={props.sortKinds}
        view={props.displayView}
        compact={props.compactControls}
      />
      {props.exportConfig && (
        <DataViewsExportMenu
          config={props.exportConfig}
          query={props.c.currentQuery}
          totalCount={props.totalCount}
          selectedIds={[...props.c.selectedIds]}
          columns={props.columnOptions.filter((col) => col.visible).map((col) => ({ id: col.id, label: col.label }))}
          testIdPrefix={testIdPrefix}
          compact={props.compactControls}
        />
      )}
      {props.showFilterTrigger !== false && (
        <FilterTrigger
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={props.activeFilterCount}
          data-testid={`${testIdPrefix}-filters-toggle`}
        />
      )}
    </>
  );
}

/**
 * The bordered toolbar band: selection chrome + Sort By, the result counter, the
 * saved-views slot, and the filter funnel. The negative margin lets the top/bottom
 * separators reach the sidebar's vertical line and the window edge.
 */
export function GridToolbar<T extends Record<string, unknown>>(props: GridToolbarProps<T>): React.JSX.Element {
  const copy = useDataViewsCopy();
  const { testIdPrefix, selectedRows } = props;
  return (
    <Box
      ref={props.barRef}
      sx={{
        borderTop: 1,
        borderBottom: 1,
        borderColor: "divider",
        py: 1.25,
        mx: { xs: -2, md: -3 },
        px: { xs: 2, md: 3 },
      }}
    >
      <ContentToolbar
        selectAllLabel={copy.selection.selectAll}
        selectAllText={copy.selection.selectAllOnPage}
        clearAllText={copy.filters.clearAll}
        hasSelection={selectedRows.length > 0}
        selectedCount={selectedRows.length}
        selectAll={props.selectAll}
        clearSelection={props.clearSelection}
        selectAllTestId={`${testIdPrefix}-select-all`}
        clearAllTestId={`${testIdPrefix}-clear-all`}
        actions={renderBulkActions({
          rowActions: props.rowActions,
          bulkActions: props.bulkActions,
          selectedRows,
          clearSelection: props.clearSelection,
          testIdPrefix,
        })}
        leadingControls={props.filterControls}
        // Selection takes the whole line: no Select All while browsing, and no
        // search/filters/Exibir/Exportar once a row is ticked.
        exclusiveSelection
        rightControls={<ToolbarRightControls {...props} />}
      />
    </Box>
  );
}
