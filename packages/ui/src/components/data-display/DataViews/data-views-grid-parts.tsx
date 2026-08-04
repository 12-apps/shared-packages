"use client";

import { useMediaQuery, useTheme } from "@mui/material";
import { useState } from "react";

import {
  DataGrid,
  type GridColumn,
  type GridSort,
} from "../DataGrid";
import {
  type ColumnVisibilityOption,
} from "../../layout/ContentToolbar";
import { TableFilter } from "../../layout/TableFilter";
import { Box } from "../../../mui/Box";
import { Stack } from "../../../mui/Stack";

import {
  cardMinWidthForZoom,
  cardScaleForZoom,
  DataViewsLayoutProvider,
  useDataViewsLayout,
  type DataViewsLayout,
} from "./data-views-layout-context";
import { FilterDialog, GridFilterPanel, InlineFilterBar } from "./data-views-filter-panel";
import { GridToolbar } from "./data-views-toolbar";
import { DataViewsPagination } from "./data-views-pagination";
import { togglePillValues } from "./data-views-grid-helpers";
import type {
  DataViewCardSelection,
  FilterFieldConfig,
  RangeFieldConfig,
  RangeValue,
  RowAction,
} from "./data-views-types";
import type { DataViewsController } from "./use-data-views-state";

/* ── Body (grid) ─────────────────────────────────────────────────────────── */

interface GridBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  columns: GridColumn<T>[];
  getRowId: (row: T) => string | number;
  selectedIds: Array<string | number>;
  onChangeSelected: (ids: Array<string | number>) => void;
  sortBy: GridSort[];
  onChangeSortBy: (next: GridSort[]) => void;
  /** "server" defers ordering to the backend (rows render as-is); "client" sorts in-grid. */
  sortMode: "client" | "server";
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/** The dense DataGrid with multi-select, wrapped in the scrollable table region. */
function GridBody<T extends Record<string, unknown>>({
  rows,
  columns,
  getRowId,
  selectedIds,
  onChangeSelected,
  sortBy,
  onChangeSortBy,
  sortMode,
  dataTestId,
  emptyState,
}: GridBodyProps<T>): React.JSX.Element {
  return (
    <Box
      sx={{
        width: "100%",
        overflowX: "auto",
        mt: 1.5,
        // Tabwoah-style dense rows: MUI's default TableCell padding keeps rows
        // tall regardless of rowHeight, so trim it here.
        "& .MuiTableCell-root": { py: 0.25, fontSize: "0.8125rem" },
        "& .MuiTableCell-head": { py: 0.5, fontSize: "0.75rem" },
      }}
    >
      <DataGrid<T>
        rows={rows}
        columns={columns}
        getRowId={(row) => getRowId(row)}
        virtualizeRows={false}
        density="compact"
        rowHeight={36}
        headerHeight={36}
        selection={{ mode: "multi", selectedRowIds: selectedIds, onChangeSelected }}
        sorting={{ mode: sortMode, sortBy, onChangeSortBy }}
        data-testid={dataTestId}
        emptyState={emptyState}
      />
    </Box>
  );
}

/* ── Body (cards) ────────────────────────────────────────────────────────── */

interface CardBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  renderCard: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  getRowId: (row: T) => string | number;
  selectedIds: Set<string | number>;
  onToggleId: (id: string | number) => void;
  minCardWidth: number;
  /** Content scale (padding + type) handed to each card, from the zoom slider. */
  cardScale: number;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/**
 * The "Grade" layout: the filtered/sorted rows rendered as an auto-filling grid
 * of entity-supplied cards. Reuses `rows` (= `c.matched`), so search/filter/sort
 * apply; the column width comes from the zoom slider, and each card is handed its
 * selection state so it can drive its own checkbox (BaseCard) — the same
 * selection model as the table.
 */
function CardBody<T extends Record<string, unknown>>({
  rows,
  renderCard,
  getRowId,
  selectedIds,
  onToggleId,
  minCardWidth,
  cardScale,
  dataTestId,
  emptyState,
}: CardBodyProps<T>): React.JSX.Element {
  if (rows.length === 0) {
    return <Box sx={{ mt: 1.5 }}>{emptyState}</Box>;
  }
  return (
    <Box
      sx={{
        mt: 1.5,
        display: "grid",
        // Fixed inter-card gap — deliberately NOT scaled by the zoom slider, so
        // only the cards grow while the space between them stays constant.
        gap: 1.5,
        gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
      }}
      data-testid={dataTestId ? `${dataTestId}-cards` : "data-views-cards"}
    >
      {rows.map((row) => {
        const id = getRowId(row);
        return (
          <Box key={id}>
            {renderCard(row, {
              selected: selectedIds.has(id),
              onToggleSelect: () => onToggleId(id),
              scale: cardScale,
            })}
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Body selector (cards vs table, from context) ────────────────────────── */

interface GridMainProps<T extends Record<string, unknown>> {
  c: DataViewsController<T>;
  getRowId: (row: T) => string | number;
  renderCard?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/** Picks the body to render from the layout context: cards or the dense grid. */
function GridMain<T extends Record<string, unknown>>({
  c,
  getRowId,
  renderCard,
  dataTestId,
  emptyState,
}: GridMainProps<T>): React.JSX.Element {
  const { layout, zoom } = useDataViewsLayout();
  if (layout === "cards" && renderCard) {
    return (
      <CardBody
        rows={c.matched}
        renderCard={renderCard}
        getRowId={getRowId}
        selectedIds={c.selectedIds}
        onToggleId={(id) => {
          const next = new Set(c.selectedIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          c.setSelectedIds(next);
        }}
        minCardWidth={cardMinWidthForZoom(zoom)}
        cardScale={cardScaleForZoom(zoom)}
        dataTestId={dataTestId}
        emptyState={emptyState}
      />
    );
  }
  return (
    <GridBody
      rows={c.matched}
      columns={c.gridColumns}
      getRowId={getRowId}
      selectedIds={[...c.selectedIds]}
      onChangeSelected={(ids) => c.setSelectedIds(new Set(ids))}
      sortBy={c.state.sortBy}
      onChangeSortBy={(next: GridSort[]) => c.patch({ sortBy: next })}
      sortMode={c.serverMode ? "server" : "client"}
      dataTestId={dataTestId}
      emptyState={emptyState}
    />
  );
}

/* ── Shell (composes toolbar + body + panel) ─────────────────────────────── */

/** The shared filter-surface props consumed by the inline bar, panel, and modal. */
interface FilterSurfaceProps<T extends Record<string, unknown>> {
  testIdPrefix: string;
  search: string;
  fields: FilterFieldConfig<T>[];
  rangeFields: RangeFieldConfig<T>[];
  pills: Record<string, string[]>;
  ranges: Record<string, RangeValue>;
  onSearchChange: (value: string) => void;
  onTogglePill: (fieldId: string, value: string, checked: boolean) => void;
  onChangeRange: (fieldId: string, range: RangeValue) => void;
  onClearField: (fieldId: string) => void;
  onClearAll: () => void;
}

/**
 * Derives the responsive filter state (which surface to show at this width) and
 * the filter-mutation handlers from the controller — pulled out of `GridShell`
 * so the component body stays under the size/complexity budget.
 */
/** Grouped rather than positional: the list had grown past readability. */
interface GridShellFiltersArgs<T extends Record<string, unknown>> {
  c: DataViewsController<T>;
  inlineFilters: boolean;
  fields: FilterFieldConfig<T>[];
  rangeFields: RangeFieldConfig<T>[];
  testIdPrefix: string;
  alwaysShowSearch: boolean;
}

function useGridShellFilters<T extends Record<string, unknown>>({
  c,
  inlineFilters,
  fields,
  rangeFields,
  testIdPrefix,
  alwaysShowSearch,
}: GridShellFiltersArgs<T>): {
  showInline: boolean;
  useModal: boolean;
  inlineVisible: boolean;
  filtersHidden: boolean;
  toggleFilters: () => void;
  filterProps: FilterSurfaceProps<T>;
} {
  const { state } = c;
  // Read the theme explicitly (falls back to the default when there's no
  // ThemeProvider) so the query never dereferences a null theme. `noSsr`
  // evaluates on the client only (no hydration mismatch).
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"), { noSsr: true });
  const [filtersHidden, setFiltersHidden] = useState(false);
  const showInline = inlineFilters && wide;
  const useModal = inlineFilters && !wide;
  const inlineVisible =
    showInline && !filtersHidden && (alwaysShowSearch || fields.length > 0 || state.search !== "");
  const filterProps: FilterSurfaceProps<T> = {
    testIdPrefix,
    search: state.search,
    fields,
    rangeFields,
    pills: state.pills,
    ranges: c.ranges,
    onSearchChange: (value) => c.patch({ search: value }),
    onTogglePill: (fieldId, value, checked) =>
      c.patch({ pills: { ...state.pills, [fieldId]: togglePillValues(state.pills[fieldId], value, checked) } }),
    onChangeRange: (fieldId, range) => c.patch({ ranges: { ...c.ranges, [fieldId]: range } }),
    onClearField: (fieldId) => c.patch({ pills: { ...state.pills, [fieldId]: [] } }),
    onClearAll: () => c.patch({ search: "", pills: {}, ranges: {} }),
  };
  return { showInline, useModal, inlineVisible, filtersHidden, toggleFilters: () => setFiltersHidden((v) => !v), filterProps };
}

interface GridShellProps<T extends Record<string, unknown>> {
  c: DataViewsController<T>;
  rows: T[];
  fields: FilterFieldConfig<T>[];
  rangeFields: RangeFieldConfig<T>[];
  getRowId: (row: T) => string | number;
  testIdPrefix: string;
  dataTestId?: string;
  emptyState?: React.ReactNode;
  toolbarRightSlot?: React.ReactNode;
  rowActions?: RowAction<T>[];
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  /** Opt-in "Grade" (cards) layout: renders each row as an entity-supplied card.
   *  Omit ⇒ table only (no layout toggle). */
  renderCard?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** Which layout to show first when cards are available (default "table"). */
  defaultLayout?: DataViewsLayout;
  /**
   * Opt into the responsive inline filter UX: a collapsible filter row below the
   * toolbar on wide screens and a modal on narrow ones. When false (default),
   * keep the classic slide-in filter panel opened by the "Filtros" button.
   */
  inlineFilters?: boolean;
  /**
   * Keep the inline search box on screen even with no filter fields and no
   * active search. Without it a grid whose only filter IS the search (`fields`
   * empty) can never OFFER one: the row renders only once a search exists, so
   * the operator would have to hand-edit the URL to start one. Default false —
   * every grid that ships filter fields already shows the row.
   */
  alwaysShowSearch?: boolean;
}

/** Wires the controller into the shared toolbar + filter panel + grid/cards body. */
export function GridShell<T extends Record<string, unknown>>({
  c,
  rows,
  fields,
  rangeFields,
  getRowId,
  testIdPrefix,
  dataTestId,
  emptyState,
  toolbarRightSlot,
  rowActions,
  bulkActions,
  renderCard,
  defaultLayout,
  inlineFilters = false,
  alwaysShowSearch = false,
}: GridShellProps<T>): React.JSX.Element {
  const { state } = c;
  const { showInline, useModal, inlineVisible, filtersHidden, toggleFilters, filterProps } = useGridShellFilters(
    { c, inlineFilters, fields, rangeFields, testIdPrefix, alwaysShowSearch },
  );
  const columnOptions: ColumnVisibilityOption[] = c.hideableColumns.map((col) => ({
    id: col.id,
    label: col.label,
    visible: state.visibleColumns.includes(col.id),
  }));
  return (
    <DataViewsLayoutProvider canUseCards={Boolean(renderCard)} defaultLayout={defaultLayout}>
    <TableFilter open={c.filterOpen} onOpenChange={c.setFilterOpen} hasActiveFilters={c.activeFilterCount > 0}>
      <Stack spacing={0} data-testid={dataTestId ? `${dataTestId}-container` : undefined}>
        <GridToolbar
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
          showFiltersToggle={showInline}
          filtersHidden={filtersHidden}
          onToggleFilters={toggleFilters}
        />
        {inlineVisible && <InlineFilterBar {...filterProps} />}
        <TableFilter.Layout>
          <TableFilter.Main>
            <GridMain
              c={c}
              getRowId={getRowId}
              renderCard={renderCard}
              dataTestId={dataTestId}
              emptyState={emptyState}
            />
            <DataViewsPagination c={c} testIdPrefix={testIdPrefix} />
          </TableFilter.Main>
          {!inlineFilters && <GridFilterPanel {...filterProps} />}
        </TableFilter.Layout>
        {useModal && <FilterDialog open={c.filterOpen} onClose={() => c.setFilterOpen(false)} {...filterProps} />}
      </Stack>
    </TableFilter>
    </DataViewsLayoutProvider>
  );
}
