"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type GridColumn } from "../DataGrid";
import { type SortFieldDefinition } from "../../layout/ContentToolbar";

import { filterRows } from "./data-views-filter";
import {
  buildGridColumns,
  buildRowActionsColumn,
  computeActiveFilterCount,
  defaultSortFields,
  isActionsColumn,
} from "./data-views-grid-helpers";
import {
  emptyViewState,
  type DataViewColumn,
  type DataViewServer,
  type DataViewState,
  type DataViewSyncState,
  type FilterFieldConfig,
  type RangeFieldConfig,
  type RangeValue,
  type RowAction,
} from "./data-views-types";

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
}

/** A column the user may show/hide via the toolbar's ColumnsMenu. */
export interface HideableColumn {
  id: string;
  label: string;
}

/** Everything the DataViewsGrid render needs; keeps the component itself thin. */
export interface DataViewsController<T extends Record<string, unknown>> {
  state: DataViewState;
  ranges: Record<string, RangeValue>;
  patch: (next: Partial<DataViewState>) => void;
  matched: T[];
  gridColumns: GridColumn<T>[];
  /** Columns eligible for the show/hide menu (hideable, with a text header). */
  hideableColumns: HideableColumn[];
  /** Toggle one column's visibility in the current view state. */
  toggleColumn: (id: string, visible: boolean) => void;
  selectedIds: Set<string | number>;
  setSelectedIds: (ids: Set<string | number>) => void;
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
 * Server-mode wiring extracted from {@link useDataViewsState} (keeps it within
 * the size/complexity budget): re-fetch on every effective-query change (page
 * resets to 1) and expose `changePage` for the pagination control. Read the
 * latest `state`/`server` at fire time so an inline `server` object per render
 * doesn't loop the effect.
 */
function useServerQuery(server: DataViewServer | undefined, state: DataViewState): {
  changePage: (page: number) => void;
} {
  const emit = (page: number): void => {
    if (!server) return;
    server.onQueryChange({
      search: state.search,
      pills: state.pills,
      ranges: state.ranges ?? {},
      sortBy: state.sortBy,
      page,
      pageSize: server.pageSize,
    });
  };
  const queryKey = server
    ? JSON.stringify({ q: state.search, pills: state.pills, ranges: state.ranges ?? {}, sort: state.sortBy })
    : "";
  const firstQuery = useRef(true);
  useEffect(() => {
    if (!server) return;
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    emit(1);
    // Emit only when the query key changes; `emit` reads fresh state at fire time.
  }, [queryKey]);
  return { changePage: (page: number) => emit(page) };
}

/** The controller's server-mode derived fields (or client-mode defaults). */
function serverDerived(
  server: DataViewServer | undefined,
  fallbackCount: number,
): { serverMode: boolean; serverPage: number; serverPageCount: number; serverTotalCount: number } {
  if (!server) {
    return { serverMode: false, serverPage: 1, serverPageCount: 1, serverTotalCount: fallbackCount };
  }
  return {
    serverMode: true,
    serverPage: server.page,
    serverPageCount: Math.max(1, Math.ceil(server.totalCount / server.pageSize)),
    serverTotalCount: server.totalCount,
  };
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
}: UseDataViewsStateArgs<T>): DataViewsController<T> {
  // Append the auto kebab column unless the page defines one (see helper).
  const columnsWithActions = useMemo(
    () =>
      appendActionsColumn(columns, { rowActions, rowActionsLeading, renderRowMenu, testIdPrefix, getRowId }),
    [columns, rowActions, rowActionsLeading, renderRowMenu, testIdPrefix, getRowId],
  );
  const allColumnIds = useMemo(() => columnsWithActions.map((col) => col.id), [columnsWithActions]);
  // Seed once: a saved view (`appliedState`) or a pristine all-columns state, with
  // the URL-driven controls (`syncState`) merged over it so a deep-linked filter
  // is reflected on first render. Column visibility is never URL-carried.
  const [state, setState] = useState<DataViewState>(() => {
    const seed = appliedState ?? emptyViewState(allColumnIds);
    return syncState ? { ...seed, ...syncState } : seed;
  });
  const [selectedIds, setSelectedIdsState] = useState<Set<string | number>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  useStateSyncEffects(appliedState, syncState, state, onStateChange, setState);

  const patch = (next: Partial<DataViewState>): void => setState((prev) => ({ ...prev, ...next }));
  const matched = useMatchedRows(server, rows, columns, fields, rangeFields, state);
  // Server mode: re-fetch on query change (page resets to 1) + drive pagination.
  const { changePage } = useServerQuery(server, state);
  const gridColumns = useMemo(
    () => buildGridColumns(columnsWithActions, state.visibleColumns, onRowClick),
    [columnsWithActions, onRowClick, state.visibleColumns],
  );
  const hideableColumns = useMemo(() => computeHideableColumns(columnsWithActions), [columnsWithActions]);
  const toggleColumn = (id: string, visible: boolean): void =>
    setState((prev) => ({ ...prev, visibleColumns: nextVisibleColumns(prev.visibleColumns, id, visible) }));
  const selectedRows = useMemo(
    () => matched.filter((row) => selectedIds.has(getRowId(row))),
    [matched, selectedIds, getRowId],
  );
  const resolvedSortFields = sortFields ?? defaultSortFields(columns);
  const activeSort = state.sortBy?.[0];

  return {
    state,
    ranges: state.ranges ?? {},
    patch,
    matched,
    gridColumns,
    hideableColumns,
    toggleColumn,
    selectedIds,
    setSelectedIds: setSelectedIdsState,
    selectedRows,
    clearSelection: () => setSelectedIdsState(new Set()),
    selectAll: () => setSelectedIdsState(new Set(matched.map((row) => getRowId(row)))),
    filterOpen,
    setFilterOpen,
    resolvedSortFields,
    activeSortField: activeSort?.id ?? resolvedSortFields[0]?.value ?? "",
    activeSortOrder: activeSort?.dir === "desc" ? "desc" : "asc",
    activeFilterCount: computeActiveFilterCount(state, fields, rangeFields),
    ...serverDerived(server, matched.length),
    changePage,
  };
}
