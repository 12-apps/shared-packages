"use client";

import CollapseIcon from '@mui/icons-material/ExpandLess';
import ExpandIcon from '@mui/icons-material/ExpandMore';
import { IconButton, Tooltip } from "@mui/material";

import {
  ContentToolbar,
  FilterTrigger,
  type ColumnVisibilityOption,
  type SortFieldDefinition,
} from "../../layout/ContentToolbar";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { DataViewsZoomSlider } from "./data-views-layout-context";
import { DataViewsDisplayPanel, type DisplayPanelView } from "./data-views-display-panel";
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
  /** Show the ∧/∨ toggle that collapses/expands the inline filter row. */
  showFiltersToggle?: boolean;
  /** Whether the inline filter row is currently hidden. */
  filtersHidden?: boolean;
  /** Toggle the inline filter row's visibility. */
  onToggleFilters?: () => void;
  /** The controller, so "Exibir" can drive sort, columns, order and format. */
  c: DataViewsController<T>;
  /** Per-sort-field value kind, so directions read in the column's own terms. */
  sortKinds?: Record<string, string>;
  /** The saved-view chrome bracketing the Exibir panel, when the host has views. */
  displayView?: DisplayPanelView;
}

/** The right-aligned toolbar controls: Sort By, the counter, zoom/layout/columns, filters. */
function ToolbarRightControls<T extends Record<string, unknown>>(props: GridToolbarProps<T>): React.JSX.Element {
  const { testIdPrefix, matchedCount, totalCount, filterOpen, setFilterOpen } = props;
  return (
    <>
      <Text variant="caption" as="span">
        {/* The "N de N" counter is hidden on mobile to keep the toolbar one line. */}
        <Box
          component="span"
          data-testid={`${testIdPrefix}-counter`}
          sx={{ whiteSpace: "nowrap", display: { xs: "none", md: "inline" } }}
        >
          Exibindo {matchedCount} de {totalCount}
        </Box>
      </Text>
      {props.toolbarRightSlot}
      <DataViewsZoomSlider testIdPrefix={testIdPrefix} />
      {/* Sort + columns + format, in ONE control — see DataViewsDisplayPanel. */}
      <DataViewsDisplayPanel
        c={props.c}
        testIdPrefix={testIdPrefix}
        sortKinds={props.sortKinds}
        view={props.displayView}
      />
      {props.showFilterTrigger !== false && (
        <FilterTrigger
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeCount={props.activeFilterCount}
          data-testid={`${testIdPrefix}-filters-toggle`}
        />
      )}
      {props.showFiltersToggle && (
        <Tooltip title={props.filtersHidden ? "Mostrar filtros" : "Ocultar filtros"}>
          <IconButton
            size="small"
            onClick={props.onToggleFilters}
            aria-label={props.filtersHidden ? "Mostrar filtros" : "Ocultar filtros"}
            aria-expanded={!props.filtersHidden}
            data-testid={`${testIdPrefix}-filters-collapse`}
          >
            {props.filtersHidden ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
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
  const { testIdPrefix, selectedRows } = props;
  return (
    <Box
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
        rightControls={<ToolbarRightControls {...props} />}
      />
    </Box>
  );
}
