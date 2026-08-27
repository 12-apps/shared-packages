"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type GridColumn } from "../DataGrid";
import { type SortFieldDefinition } from "../../layout/ContentToolbar";

import { filterRows } from "./data-views-filter";
import {
  useColumnsWithActions,
  useRenderedColumns,
  type HideableColumn,
} from "./data-views-columns";
import { computeActiveFilterCount, defaultSortFields } from "./data-views-grid-helpers";
import { resolveScope, useScopeConfigChecks, type ScopeConfig } from "./data-views-scopes";
import { serverDerived, useServerQuery } from "./data-views-server-query";
import { useSelection } from "./data-views-selection";
import {
  emptyViewState,
  type DataViewColumn,
  type DataViewServer,
  type DataViewState,
  type DataViewStatePatch,
  type DataViewSyncState,
  type FilterFieldConfig,
  type RangeFieldConfig,
  type DataViewQuery,
  type RangeValue,
  type RowAction,
} from "./data-views-types";

export type { HideableColumn };

/** Inputs the hook needs to own the view state + derived data. */
interface UseDataViewsStateArgs<T extends Record<string, unknown>> {
  rows: T[];
  columns: DataViewColumn<T>[];
  fields: FilterFieldConfig<T>[];
  rangeFields: RangeFieldConfig<T>[];
  getRowId: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  appliedState?: DataViewState;
  /**
   * URL-driven controls (search/pills/ranges/sort) that re-apply on reference
   * change while preserving column visibility — see {@link DataViewSyncState}.
   */
  syncState?: DataViewSyncState;
  onStateChange?: (state: DataViewState) => void;
  testIdPrefix: string;
  sortFields?: SortFieldDefinition[];
  rowActions?: RowAction<T>[];
  rowActionsLeading?: (row: T) => React.ReactNode;
  /** Bespoke per-row menu rendered in the actions column instead of the auto kebab. */
  renderRowMenu?: (row: T) => React.ReactNode;
  /**
   * When present, the table is BACKEND-driven: `rows` is already the current
   * page (no in-browser filter/sort/paginate), and query changes re-fetch via
   * `server.onQueryChange`. Omit for the legacy client-side behaviour.
   */
  server?: DataViewServer;
  /**
   * The page-level partition rendered as tabs under the toolbar. Requires server
   * mode: a scope is applied at the BACKEND, never in the browser.
   */
  scopes?: ScopeConfig[];
  /**
   * The row field the scopes partition by, when the host knows it — used only to
   * reject the pill/scope clash at setup. See `assertNoScopePillOverlap`.
   */
  scopeFieldId?: string;
}

/** Everything the DataViewsGrid render needs; keeps the component itself thin. */
export interface DataViewsController<T extends Record<string, unknown>> {
  state: DataViewState;
  ranges: Record<string, RangeValue>;
  /**
   * Merge a partial into the view state.
   *
   * The UPDATER form is the one to reach for when the patch is derived from
   * state you are also changing — successive calls within one tick each see the
   * previous call's result, where the object form would have every caller build
   * its patch from the same render-scoped snapshot and the last write would win.
   */
  patch: (next: DataViewStatePatch) => void;
  matched: T[];
  gridColumns: GridColumn<T>[];
  /** Columns eligible for the show/hide menu (hideable, with a text header). */
  hideableColumns: HideableColumn[];
  /** Every column id in reading order — what the Colunas tab reorders. */
  columnOrder: string[];
  /** Toggle one column's visibility in the current view state. */
  toggleColumn: (id: string, visible: boolean) => void;
  selectedIds: Set<string | number>;
  setSelectedIds: (ids: Set<string | number>) => void;
  /**
   * Add/remove ONE id from the selection. The card and board bodies both need
   * it, so it lives here rather than being written out twice at the call sites —
   * one selection model, one toggle, identical in every layout.
   */
  toggleId: (id: string | number) => void;
  selectedRows: T[];
  clearSelection: () => void;
  selectAll: () => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  resolvedSortFields: SortFieldDefinition[];
  activeSortField: string;
  activeSortOrder: "asc" | "desc";
  activeFilterCount: number;
  /** True when the table is backend-driven (server mode). */
  serverMode: boolean;
  /** Server-mode pagination: 1-based current page (1 when client mode). */
  serverPage: number;
  /** Server-mode pagination: total pages (1 when client mode). */
  serverPageCount: number;
  /** Server-mode: total matched rows across all pages (drives the counter). */
  serverTotalCount: number;
  /** Server-mode: request a specific 1-based page (re-fetches via onQueryChange). */
  changePage: (page: number) => void;
  /**
   * The active scope id, RESOLVED against the declared scopes (see
   * `resolveScope`). `undefined` when the table declares none — which is what
   * keeps `scope` out of the emitted query for every table that never opted in.
   */
  scope: string | undefined;
  /** Select a scope: re-fetches from page 1 and drops the selection. */
  setScope: (id: string) => void;
  /**
   * The query the grid is currently showing. Read by Export, which hands it
   * back to the host UNPAGINATED — so an export follows the filters rather
   * than the 25 rows that happen to be loaded.
   */
  currentQuery: DataViewQuery;
  /**
   * Server-supplied per-scope totals, passed through verbatim, or `undefined`
   * when the server omits them. NEVER falls back to counting `matched`: a count
   * off the loaded page is wrong under pagination, which is the bug scopes fix.
   */
  scopeCounts?: Record<string, number>;
}

/**
 * The rows to render: in server mode `rows` is already the current page (the
 * backend filtered/sorted/paginated), so it passes through untouched; otherwise
 * the client search/pill/range filter narrows it.
 */
function useMatchedRows<T extends Record<string, unknown>>(
  server: DataViewServer | undefined,
  rows: T[],
  columns: DataViewColumn<T>[],
  fields: FilterFieldConfig<T>[],
  rangeFields: RangeFieldConfig<T>[],
  state: DataViewState,
): T[] {
  return useMemo(
    () =>
      server
        ? rows
        : filterRows(
            rows,
            columns,
            fields,
            { search: state.search, pills: state.pills, ranges: state.ranges },
            rangeFields,
          ),
    [server, rows, columns, fields, rangeFields, state.search, state.pills, state.ranges],
  );
}

/** Add or remove one column id from the visible-columns list. */
function nextVisibleColumns(current: string[], id: string, visible: boolean): string[] {
  const without = current.filter((colId) => colId !== id);
  return visible ? [...without, id] : without;
}

/**
 * Reconcile external state changes and surface every change to the caller:
 * - `appliedState` (a saved view) fully REPLACES the state — it is columns-
 *   authoritative, so applying a view restores its filters, sort AND columns.
 * - `syncState` (URL-driven controls) MERGES over the current state, leaving
 *   `visibleColumns` untouched — so browser back/forward or a same-route
 *   deep-link re-applies search/pills/sort without wiping a user's hidden columns.
 * Each channel only fires when its own reference changes (after the first run).
 */
function useStateSyncEffects(
  appliedState: DataViewState | undefined,
  syncState: DataViewSyncState | undefined,
  state: DataViewState,
  onStateChange: ((state: DataViewState) => void) | undefined,
  setState: React.Dispatch<React.SetStateAction<DataViewState>>,
): void {
  const firstApplied = useRef(true);
  useEffect(() => {
    if (firstApplied.current) {
      firstApplied.current = false;
      return;
    }
    if (appliedState) setState(appliedState);
    // `setState` is a stable useState setter (passed in), included to satisfy
    // exhaustive-deps; the effect still only re-applies when `appliedState` changes.
  }, [appliedState, setState]);
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    // Merge — keep the current `visibleColumns` (never URL-carried); only the
    // URL-driven controls change.
    if (syncState) setState((prev) => ({ ...prev, ...syncState }));
  }, [syncState, setState]);
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);
}

/**
 * The seed view state: a saved view (`appliedState`) or a pristine all-columns
 * one, with the URL-driven controls (`syncState`) merged over it so a deep-linked
 * filter or scope is reflected on the FIRST render. Column visibility is never
 * URL-carried, so the merge cannot wipe it.
 */
function seedState(
  appliedState: DataViewState | undefined,
  syncState: DataViewSyncState | undefined,
  allColumnIds: string[],
): DataViewState {
  const seed = appliedState ?? emptyViewState(allColumnIds);
  return syncState ? { ...seed, ...syncState } : seed;
}

/**
 * Selecting a scope: record it, then DROP the selection.
 *
 * A scope change renders a different result set. A selection that survived it
 * would let a bulk action run against rows the user can no longer see — the
 * same reason changing any other part of the query clears it.
 */
function makeSetScope(
  patch: (next: DataViewStatePatch) => void,
  clearSelection: () => void,
): (id: string) => void {
  return (id) => {
    patch({ scope: id });
    clearSelection();
  };
}

/**
 * The declared column ids in the stored reading order — the same tolerance
 * `applyOrder` uses, so the Colunas tab lists exactly what the grid renders.
 */
function orderedColumnIds(allColumnIds: string[], order: string[] | undefined): string[] {
  if (!order || order.length === 0) return allColumnIds;
  const declared = new Set(allColumnIds);
  const kept = order.filter((id) => declared.has(id));
  const seen = new Set(kept);
  return [...kept, ...allColumnIds.filter((id) => !seen.has(id))];
}

/**
 * The query the grid is currently SHOWING — the same shape `onQueryChange`
 * emits, kept as a value so a host control (Exportar) can re-run it against the
 * backend rather than reading the loaded rows.
 */
function liveQuery(
  state: DataViewState,
  scope: string | undefined,
  server: DataViewServer | undefined,
  matchedCount: number,
): DataViewQuery {
  return {
    search: state.search,
    pills: state.pills,
    ranges: state.ranges ?? {},
    sortBy: state.sortBy,
    // Absent, not undefined, when the table declares no scopes.
    ...(scope !== undefined ? { scope } : {}),
    page: server?.page ?? 1,
    // Client mode has one page, and it is everything that matched.
    pageSize: server?.pageSize ?? matchedCount,
  };
}

/** The toolbar's active sort, read off the state's FIRST sort entry. */
function activeSortOf(
  state: DataViewState,
  resolvedSortFields: SortFieldDefinition[],
): { activeSortField: string; activeSortOrder: "asc" | "desc" } {
  const active = state.sortBy?.[0];
  return {
    activeSortField: active?.id ?? resolvedSortFields[0]?.value ?? "",
    activeSortOrder: active?.dir === "desc" ? "desc" : "asc",
  };
}

/**
 * Owns the DataViews view state (search/pills/ranges/sort/visibleColumns),
 * multi-select, the filter-panel toggle, and every derived value (filtered rows,
 * grid columns, active sort/filter counts). Extracted from the component so the
 * render stays within the size/complexity budget.
 */
export function useDataViewsState<T extends Record<string, unknown>>({
  rows,
  columns,
  fields,
  rangeFields,
  getRowId,
  onRowClick,
  appliedState,
  syncState,
  onStateChange,
  testIdPrefix,
  sortFields,
  rowActions,
  rowActionsLeading,
  renderRowMenu,
  server,
  scopes = [],
  scopeFieldId,
}: UseDataViewsStateArgs<T>): DataViewsController<T> {
  useScopeConfigChecks(scopes, fields.map((field) => field.id), scopeFieldId, server !== undefined);
  const { columnsWithActions, allColumnIds } = useColumnsWithActions(columns, {
    rowActions,
    rowActionsLeading,
    renderRowMenu,
    testIdPrefix,
    getRowId,
  });
  // Seed once — see {@link seedState}.
  const [state, setState] = useState<DataViewState>(() =>
    seedState(appliedState, syncState, allColumnIds),
  );
  const [filterOpen, setFilterOpen] = useState(false);

  useStateSyncEffects(appliedState, syncState, state, onStateChange, setState);

  const patch = (next: DataViewStatePatch): void =>
    setState((prev) => ({ ...prev, ...(typeof next === "function" ? next(prev) : next) }));
  const matched = useMatchedRows(server, rows, columns, fields, rangeFields, state);
  // Resolved at READ time, every render: a stale deep link or a saved view naming
  // a scope that has since been removed falls back to the first declared scope
  // instead of putting an id the backend rejects on the wire.
  const scope = resolveScope(scopes, state.scope);
  // Server mode: re-fetch on query change (page resets to 1) + drive pagination.
  const { changePage } = useServerQuery(server, state, scope);
  const { gridColumns, hideableColumns } = useRenderedColumns(
    columnsWithActions,
    state.visibleColumns,
    onRowClick,
    state.order,
  );
  const toggleColumn = (id: string, visible: boolean): void =>
    setState((prev) => ({ ...prev, visibleColumns: nextVisibleColumns(prev.visibleColumns, id, visible) }));
  // Server mode is where `matched` is a PAGE — see `useSelection` (FUT-942).
  const selection = useSelection(matched, getRowId, { rememberOffPage: Boolean(server) });
  const resolvedSortFields = sortFields ?? defaultSortFields(columns);

  return {
    state,
    ranges: state.ranges ?? {},
    patch,
    matched,
    gridColumns,
    hideableColumns,
    columnOrder: orderedColumnIds(allColumnIds, state.order),
    toggleColumn,
    ...selection,
    filterOpen,
    setFilterOpen,
    resolvedSortFields,
    ...activeSortOf(state, resolvedSortFields),
    activeFilterCount: computeActiveFilterCount(state, fields, rangeFields),
    ...serverDerived(server, matched.length),
    changePage,
    scope,
    setScope: makeSetScope(patch, selection.clearSelection),
    currentQuery: liveQuery(state, scope, server, matched.length),
    // Verbatim, or absent. See DataViewServer.scopeCounts for why there is no
    // client-side fallback.
    scopeCounts: server?.scopeCounts,
  };
}
