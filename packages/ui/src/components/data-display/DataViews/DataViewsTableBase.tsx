"use client";

import type { SortFieldDefinition } from "../../layout/ContentToolbar";
import { useMemo } from "react";

import { DataViewsGrid } from "./DataViewsGrid";
import type { BoardConfig } from "./DataViewsBoard";
import type { DataViewExport } from "./data-views-export";
import type { ScopeConfig } from "./data-views-scopes";
import { ViewDialogs, ViewMutationErrorAlert, ViewsMenuSlot } from "./data-views-table-parts";
import {
  useSavedViewsController,
  type SavedViewsController,
} from "./use-saved-views-controller";
import {
  type DataViewColumn,
  type DataViewsLayout,
  type DataViewServer,
  type DataViewState,
  type DataViewSyncState,
  type DataViewPersistence,
  type DataViewRouter,
  type FilterFieldConfig,
  type RangeFieldConfig,
  type DataViewCardSelection,
  type RowAction,
  type SavedViewSummary,
} from "./data-views-types";

export interface DataViewsTableBaseProps<T extends Record<string, unknown>> {
  /** The applied-view id read from the URL (`?view=`) on load, or null. */
  initialViewId?: string | null;
  /** Injected saved-view persistence (create/update/delete). */
  persistence: DataViewPersistence;
  /** Injected router side-effects (URL sync + refresh). */
  router: DataViewRouter;
  rows: T[];
  columns: DataViewColumn<T>[];
  fields: FilterFieldConfig<T>[];
  /** Optional numeric min/max range filters (advanced "filter by amount"). */
  rangeFields?: RangeFieldConfig<T>[];
  getRowId: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  dataTestId?: string;
  testIdPrefix?: string;
  /** The user's + shared views for this table (from the server). */
  views: SavedViewSummary[];
  /** Big page title in the table header, beside the funnel + gear (GTA layout). */
  title?: string;
  /** Primary page actions (e.g. "Novo produto") rendered at the header's right. */
  headerActions?: React.ReactNode;
  /** Sort options for the toolbar's "Sort By" dropdown (defaults to sortable columns). */
  sortFields?: SortFieldDefinition[];
  /**
   * Per-sort-field VALUE KIND (`"currency" | "number" | "date" | "text"`), so the
   * Exibir panel phrases the direction in that column's own terms. "Crescente"
   * on a currency column is a puzzle; "Menor → maior" is not. Defaults to text.
   */
  sortKinds?: Record<string, string>;
  /**
   * Opt-in "Exportar" control. The grid hands the host the current query,
   * UNPAGINATED, and the host re-queries — the grid never fetches, and an
   * export therefore follows the filters rather than the loaded page.
   */
  exportConfig?: DataViewExport;
  /** Notified with the currently-visible (filtered) rows, so Export matches the view. */
  onVisibleRowsChange?: (rows: T[]) => void;
  /** Reusable row actions driving both the row "⋮" kebab and the bulk menu. */
  rowActions?: RowAction<T>[];
  /** Leading control in the auto kebab column (e.g. a favourite star). */
  rowActionsLeading?: (row: T) => React.ReactNode;
  /** Low-level bulk-action override; prefer `rowActions`. */
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  /** Bespoke per-row menu (an entity's self-contained 3-dots menu) instead of the auto kebab. */
  renderRowMenu?: (row: T) => React.ReactNode;
  /** Opt-in "Grade" (cards) layout — a card renderer per row; adds a Grade/Tabela toggle. */
  renderCard?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** Opt-in "Quadro" (board) layout — the loaded page as columns of one field. Needs `renderCard`. */
  board?: BoardConfig<T>;
  /** Opt-in "Lista" layout — one full-width, entity-rendered row per record (FUT-733). */
  renderListRow?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** The page-level partition rendered as tabs above the toolbar (server mode only). */
  scopes?: ScopeConfig[];
  /** The row field the scopes partition by — used only to reject a pill over the same field. */
  scopeFieldId?: string;
  /** Which layout to show first when the user has expressed no preference (default "table"). */
  defaultLayout?: DataViewsLayout;
  /** Opt into the responsive inline filter UX (collapsible row / modal). Default keeps the panel. */
  inlineFilters?: boolean;
  /** Keep the inline search visible with no filter fields and no active search. */
  alwaysShowSearch?: boolean;
  /** Server-mode wiring (FUT-180): backend-driven rows/total + re-fetch. Omit for client mode. */
  server?: DataViewServer;
  /** Seed the initial view state (search/pills/ranges/sort) from the URL when no saved view applies. */
  initialState?: DataViewState;
}

/**
 * Derive the grid's reactive `syncState` from the URL-seeded `initialState` in
 * server mode so browser back/forward RE-APPLIES the search/pills/sort controls
 * (merging over live state, preserving hidden columns — see {@link DataViewSyncState}).
 * Client-mode tables (no `server`) get `undefined`. Callers memoize `initialState`
 * on the URL, so this reference only changes on genuine navigations.
 */
function useUrlSyncState(
  server: DataViewServer | undefined,
  initialState: DataViewState | undefined,
): DataViewSyncState | undefined {
  const isServerMode = server !== undefined;
  return useMemo<DataViewSyncState | undefined>(
    () =>
      isServerMode && initialState
        ? {
            search: initialState.search,
            pills: initialState.pills,
            ranges: initialState.ranges,
            sortBy: initialState.sortBy,
            // The scope belongs in the URL-driven slice alongside them: a
            // `?view=recusados`-style deep link and browser back/forward must
            // move the tab strip, and they must do it WITHOUT resetting the
            // user's hidden columns — which is the whole reason this is a
            // merging `syncState` and not a replacing `appliedState`.
            scope: initialState.scope,
          }
        : undefined,
    [isServerMode, initialState],
  );
}

/**
 * Resolve the initial applied view: a `?view=<id>` shortcut (FUT-90) wins, else
 * the user's default view, else none. Drives the seed state + trigger label.
 */
function resolveInitialView(
  views: SavedViewSummary[],
  requestedId: string | null,
): SavedViewSummary | undefined {
  const requested = requestedId ? views.find((view) => view.id === requestedId) : undefined;
  return requested ?? views.find((view) => view.isDefault);
}

/**
 * The saved-views dropdown wired to the controller — the toolbar's right slot.
 * Extracted so the {@link DataViewsTable} render stays within the size budget.
 */
function ViewsMenu(props: {
  views: SavedViewSummary[];
  ctl: SavedViewsController;
  testIdPrefix: string;
}): React.JSX.Element {
  const { views, ctl, testIdPrefix } = props;
  return (
    <ViewsMenuSlot
      views={views}
      activeViewName={ctl.activeViewName}
      applyView={ctl.applyView}
      selectMain={ctl.selectMain}
      openCreate={ctl.openCreate}
      openEdit={ctl.openEdit}
      handleDelete={ctl.handleDelete}
      patchView={ctl.patchView}
      onManageAll={() => ctl.setManageOpen(true)}
      testIdPrefix={testIdPrefix}
    />
  );
}

/**
 * The reusable admin table (FUT-89): the DataViews grid plus the full saved-views
 * experience — a views dropdown, a save/edit modal (with preview), and a manage
 * dialog. Framework-agnostic: saved-view persistence and router side-effects are
 * INJECTED (`persistence`, `router`, `initialViewId`) so the host app wires them
 * to its backend + framework router. A default view auto-applies on load; applying
 * a view restores its filters + columns + sort. Each table supplies its own columns
 * + filter fields; everything else is shared.
 */
export function DataViewsTableBase<T extends Record<string, unknown>>(
  props: DataViewsTableBaseProps<T>,
): React.JSX.Element {
  // Forwarded as a whole rather than restated name-by-name twice (as in
  // DataViewsGrid): this component only ADDS the saved-views chrome, and a
  // 30-name destructure repeated in the JSX is exactly where a newly added prop
  // silently stops being passed on.
  const {
    initialViewId = null,
    persistence,
    router,
    columns,
    fields,
    testIdPrefix = "table",
    views,
    server,
    initialState,
  } = props;
  const initialView = resolveInitialView(views, initialViewId);
  const columnIds = columns.map((col) => col.id);
  const ctl = useSavedViewsController(persistence, router, columnIds, views, initialView, initialState);
  // Server-mode lists re-apply URL-derived controls on back/forward (not just the mount seed).
  const syncState = useUrlSyncState(server, initialState);

  return (
    <>
      <ViewMutationErrorAlert error={ctl.mutationError} onClose={ctl.clearMutationError} testIdPrefix={testIdPrefix} />
      <DataViewsGrid<T>
        {...props}
        testIdPrefix={testIdPrefix}
        appliedState={ctl.applied}
        syncState={syncState}
        onStateChange={(state) => (ctl.currentRef.current = state)}
        toolbarRightSlot={<ViewsMenu views={views} ctl={ctl} testIdPrefix={testIdPrefix} />}
      />
      {renderViewDialogs(ctl, fields, columns, views, testIdPrefix)}
    </>
  );
}

/** The save + manage saved-view dialogs, split out to keep the base thin. */
function renderViewDialogs<T extends Record<string, unknown>>(
  ctl: SavedViewsController,
  fields: DataViewsTableBaseProps<T>["fields"],
  columns: DataViewsTableBaseProps<T>["columns"],
  views: SavedViewSummary[],
  testIdPrefix: string,
): React.JSX.Element {
  return (
    <ViewDialogs<T>
      saveOpen={ctl.saveOpen}
      onCloseSave={ctl.closeSave}
      currentState={ctl.editing ? ctl.editing.state : ctl.currentRef.current}
      fields={fields}
      columns={columns}
      editing={ctl.editing}
      onSave={ctl.handleSave}
      manageOpen={ctl.manageOpen}
      onCloseManage={() => ctl.setManageOpen(false)}
      views={views}
      onEditFromManage={ctl.editFromManage}
      onDelete={(view) => void ctl.handleDelete(view)}
      testIdPrefix={testIdPrefix}
    />
  );
}
