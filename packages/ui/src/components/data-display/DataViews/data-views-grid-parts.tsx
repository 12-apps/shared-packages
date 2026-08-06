"use client";

import { useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useState } from "react";

import {
  type ColumnVisibilityOption,
} from "../../layout/ContentToolbar";
import { TableFilter } from "../../layout/TableFilter";
import { Text } from "../../typography/Text";
import { Box } from "../../../mui/Box";
import { Stack } from "../../../mui/Stack";

import {
  DataViewsLayoutProvider,
  useDataViewsLayout,
  type DataViewsLayout,
} from "./data-views-layout-context";
import { FilterDialog, GridFilterPanel } from "./data-views-filter-panel";
import { GridMain } from "./data-views-grid-bodies";
import { InlineFilterBar } from "./data-views-inline-bar";
import { GridToolbar } from "./data-views-toolbar";
import { DataViewsPagination } from "./data-views-pagination";
import type { BoardConfig } from "./DataViewsBoard";
import { DataViewsScopeTabs, type ScopeConfig } from "./data-views-scopes";
import { togglePillValues } from "./data-views-grid-helpers";
import type {
  DataViewCardSelection,
  FilterFieldConfig,
  RangeFieldConfig,
  RangeValue,
  RowAction,
} from "./data-views-types";
import type { DataViewsController } from "./use-data-views-state";

/* ── Header row ──────────────────────────────────────────────────────────── */

/**
 * The grid's own header row: the page title on the left, the primary page
 * actions on the right.
 *
 * `title` and `headerActions` were DECLARED on `DataViewsGridProps` and
 * `DataViewsTableBaseProps` but never destructured or forwarded — dead props
 * whose types lied to every caller that set them. Wired here rather than
 * deleted: a table that carries its own title keeps the title, the scope tabs
 * and the toolbar as one block, instead of the page having to space them.
 *
 * Renders NOTHING when neither is supplied, so no existing table gains a row.
 */
function GridHeaderRow({
  title,
  headerActions,
  testIdPrefix,
}: {
  title?: string;
  headerActions?: React.ReactNode;
  testIdPrefix: string;
}): React.JSX.Element | null {
  if (!title && !headerActions) return null;
  return (
    <Box
      data-testid={`${testIdPrefix}-header`}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        flexWrap: "wrap",
        pb: 1.5,
      }}
    >
      {title ? (
        <Text variant="heading" size="lg" as="h2">
          {title}
        </Text>
      ) : (
        <Box />
      )}
      {headerActions && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>{headerActions}</Box>}
    </Box>
  );
}

/* ── Layout ⇄ view-state mirror ──────────────────────────────────────────── */

/**
 * Mirrors the LIVE layout back into the view state, so saving a view captures
 * the layout the user is actually looking at.
 *
 * A component rather than a callback prop because only something INSIDE the
 * provider can read the layout, and only the controller can write the state.
 * The `stored !== layout` guard is what makes it idempotent: `c` is rebuilt on
 * every render, so an unguarded effect here would patch → re-render → patch.
 *
 * It re-fires when `stored` changes too, which is the case that matters after
 * applying a saved view: `appliedState` REPLACES the state, so a view saved
 * before layouts were captured clears `state.layout`, and the mirror puts the
 * current one back rather than leaving the next save with nothing to store.
 */
function LayoutStateSync<T extends Record<string, unknown>>({
  c,
}: {
  c: DataViewsController<T>;
}): null {
  const { layout } = useDataViewsLayout();
  const stored = c.state.layout;
  useEffect(() => {
    if (stored !== layout) c.patch({ layout });
    // `c` is intentionally out of the deps — see the guard above.
  }, [layout, stored]);
  return null;
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
    showInline &&
    !filtersHidden &&
    (alwaysShowSearch || fields.length > 0 || rangeFields.length > 0 || state.search !== "");
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
  /**
   * Opt-in "Quadro" (board) layout. Needs `renderCard` too — the board reuses
   * the entity's card, so a board config without one simply offers no board
   * rather than failing: that is a config gap, not a runtime error.
   */
  board?: BoardConfig<T>;
  /** Opt-in "Lista" layout: one full-width, entity-rendered row per record. */
  renderListRow?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** The page-level partition rendered as tabs above the toolbar. */
  scopes?: ScopeConfig[];
  /** Page title in the grid's own header row, above the scopes + toolbar. */
  title?: string;
  /** Primary page actions rendered at the header row's right. */
  headerActions?: React.ReactNode;
  /** Which layout to show first when the user has expressed no preference (default "table"). */
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

/**
 * The toolbar band, fed from the controller. Split out of `GridShell` for that
 * function's size budget — it is ~25 props of pure forwarding and nothing else.
 */
function ShellToolbar<T extends Record<string, unknown>>({
  c,
  rows,
  testIdPrefix,
  rowActions,
  bulkActions,
  toolbarRightSlot,
  showInline,
  filtersHidden,
  toggleFilters,
}: {
  c: DataViewsController<T>;
  rows: T[];
  testIdPrefix: string;
  rowActions?: RowAction<T>[];
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  toolbarRightSlot?: React.ReactNode;
  showInline: boolean;
  filtersHidden: boolean;
  toggleFilters: () => void;
}): React.JSX.Element {
  const columnOptions: ColumnVisibilityOption[] = c.hideableColumns.map((col) => ({
    id: col.id,
    label: col.label,
    visible: c.state.visibleColumns.includes(col.id),
  }));
  return (
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
  );
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
  board,
  renderListRow,
  scopes = [],
  title,
  headerActions,
  defaultLayout,
  inlineFilters = false,
  alwaysShowSearch = false,
}: GridShellProps<T>): React.JSX.Element {
  const { state } = c;
  const { showInline, useModal, inlineVisible, filtersHidden, toggleFilters, filterProps } =
    useGridShellFilters({ c, inlineFilters, fields, rangeFields, testIdPrefix, alwaysShowSearch });
  return (
    <DataViewsLayoutProvider
      canUseCards={Boolean(renderCard)}
      canUseList={Boolean(renderListRow)}
      // The board reuses the entity's card, so it needs BOTH — a `board` with no
      // `renderCard` offers no board rather than throwing.
      canUseBoard={Boolean(board && renderCard)}
      defaultLayout={defaultLayout}
      viewLayout={state.layout}
    >
    <LayoutStateSync c={c} />
    <TableFilter open={c.filterOpen} onOpenChange={c.setFilterOpen} hasActiveFilters={c.activeFilterCount > 0}>
      <Stack spacing={0} data-testid={dataTestId ? `${dataTestId}-container` : undefined}>
        <GridHeaderRow title={title} headerActions={headerActions} testIdPrefix={testIdPrefix} />
        {/* Renders nothing (and reserves nothing) for an empty scope list. */}
        <DataViewsScopeTabs
          scopes={scopes}
          value={c.scope}
          onChange={c.setScope}
          counts={c.scopeCounts}
          testIdPrefix={testIdPrefix}
        />
        <ShellToolbar
          c={c}
          rows={rows}
          testIdPrefix={testIdPrefix}
          rowActions={rowActions}
          bulkActions={bulkActions}
          toolbarRightSlot={toolbarRightSlot}
          showInline={showInline}
          filtersHidden={filtersHidden}
          toggleFilters={toggleFilters}
        />
        {inlineVisible && <InlineFilterBar {...filterProps} />}
        <TableFilter.Layout>
          <TableFilter.Main>
            <GridMain
              c={c}
              getRowId={getRowId}
              renderCard={renderCard}
              renderListRow={renderListRow}
              board={board}
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
