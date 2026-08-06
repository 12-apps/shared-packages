"use client";

import { useEffect } from "react";

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
import { InlineFilterChips, InlineFilterControls } from "./data-views-inline-bar";
import { toOverflowFields, useFilterOverflow, type OverflowSplit } from "./data-views-overflow";
import { ShellToolbar } from "./data-views-shell-toolbar";
import type { DisplayPanelView } from "./data-views-display-panel";
import type { DataViewExport } from "./data-views-export";
import { DataViewsEmpty } from "./data-views-empty";
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
  filterProps: FilterSurfaceProps<T>;
  split: OverflowSplit<T>;
} {
  const { state } = c;
  // ONE measurement for the whole shell: the filter row decides which controls
  // it can keep, and the TOOLBAR needs the same answer to drop its labels.
  // Measuring twice would let the two disagree at the crossover width.
  const split = useFilterOverflow(toOverflowFields(fields, rangeFields), state.pills, c.ranges);
  // THE BAR RENDERS AT EVERY WIDTH. It used to be swapped for a full-screen
  // filter MODAL below `lg`, which was the responsive strategy before the
  // measured ladder existed — and the two now do the same job, badly together:
  // the modal took the bar away at 1199px, and with it the very degradation
  // (labels off, search collapsed, filters into "Mais") that exists to make a
  // narrow bar work. So a 900px window got no bar and no ladder, and the
  // operator lost the search entirely rather than gaining a compact one.
  //
  // The ladder is measured, so it already covers every width the modal did.
  const showInline = inlineFilters;
  const useModal = false;
  const inlineVisible =
    showInline &&
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
  return { showInline, useModal, inlineVisible, filterProps, split };
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
  /** Per-sort-field value kind, so directions read in the column's own terms. */
  sortKinds?: Record<string, string>;
  /** The saved-view chrome bracketing the Exibir panel. */
  displayView?: DisplayPanelView;
  /** Injected export — the host re-queries; the grid never fetches. */
  exportConfig?: DataViewExport;
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

/** The scrollable content region: scope tabs, toolbar, filter bar, body, pager. */
function ShellStack<T extends Record<string, unknown>>({
  props,
  filters,
}: {
  props: GridShellProps<T>;
  filters: ReturnType<typeof useGridShellFilters<T>>;
}): React.JSX.Element {
  const { c, testIdPrefix, dataTestId, scopes = [], emptyState, inlineFilters = false } = props;
  const { showInline, useModal, inlineVisible, filterProps, split } = filters;
  // The grid renders the FILTERED empty state itself — it is the only party
  // that knows a filter is applied. See {@link DataViewsEmpty}.
  const body = (
    <DataViewsEmpty
      filtered={c.activeFilterCount > 0 || c.state.search !== ""}
      onClearFilters={() => c.patch({ search: "", pills: {}, ranges: {} })}
      emptyState={emptyState}
      testIdPrefix={testIdPrefix}
    />
  );
  return (
    <TableFilter open={c.filterOpen} onOpenChange={c.setFilterOpen} hasActiveFilters={c.activeFilterCount > 0}>
      <Stack spacing={0} data-testid={dataTestId ? `${dataTestId}-container` : undefined}>
        <GridHeaderRow title={props.title} headerActions={props.headerActions} testIdPrefix={testIdPrefix} />
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
          rows={props.rows}
          sortKinds={props.sortKinds}
          displayView={props.displayView}
          exportConfig={props.exportConfig}
          filterControls={
            inlineVisible ? <InlineFilterControls {...filterProps} split={split} /> : undefined
          }
          barRef={split.barRef}
          testIdPrefix={testIdPrefix}
          rowActions={props.rowActions}
          bulkActions={props.bulkActions}
          toolbarRightSlot={props.toolbarRightSlot}
          compactControls={showInline && split.compactControls}
          showInline={showInline}
        />
        {/* Only the applied-filter chips live under the toolbar now — the
            controls themselves ride on the toolbar line above. */}
        {inlineVisible && <InlineFilterChips {...filterProps} />}
        <TableFilter.Layout>
          <TableFilter.Main>
            <GridMain
              c={c}
              getRowId={props.getRowId}
              renderCard={props.renderCard}
              renderListRow={props.renderListRow}
              board={props.board}
              dataTestId={dataTestId}
              testIdPrefix={testIdPrefix}
              emptyState={body}
            />
            <DataViewsPagination c={c} testIdPrefix={testIdPrefix} />
          </TableFilter.Main>
          {inlineFilters ? null : <GridFilterPanel {...filterProps} />}
        </TableFilter.Layout>
        {useModal && <FilterDialog open={c.filterOpen} onClose={() => c.setFilterOpen(false)} {...filterProps} />}
      </Stack>
    </TableFilter>
  );
}

export function GridShell<T extends Record<string, unknown>>(props: GridShellProps<T>): React.JSX.Element {
  const {
    c,
    fields,
    rangeFields,
    testIdPrefix,
    renderCard,
    renderListRow,
    board,
    defaultLayout,
    inlineFilters = false,
    alwaysShowSearch = false,
  } = props;
  const filters = useGridShellFilters({ c, inlineFilters, fields, rangeFields, testIdPrefix, alwaysShowSearch });
  return (
    <DataViewsLayoutProvider
      canUseCards={Boolean(renderCard)}
      canUseList={Boolean(renderListRow)}
      // The board reuses the entity's card, so it needs BOTH — a `board` with no
      // `renderCard` offers no board rather than throwing.
      canUseBoard={Boolean(board && renderCard)}
      defaultLayout={defaultLayout}
      viewLayout={c.state.layout}
    >
    <LayoutStateSync c={c} />
    <ShellStack props={props} filters={filters} />
    </DataViewsLayoutProvider>
  );
}
