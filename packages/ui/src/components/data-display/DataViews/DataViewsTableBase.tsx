"use client";

import type { SortFieldDefinition } from "../../layout/ContentToolbar";
import { useEffect, useMemo, useRef, useState } from "react";

import { DataViewsGrid } from "./DataViewsGrid";
import type { SelectionExtraRender } from "./data-views-selection-extra";
import type { ListGroupConfig } from "./list-card-rails";
import type { DisplayPanelView } from "./data-views-display-panel";
import { viewStateKey } from "./data-views-dirty";
import { DeleteViewDialog } from "./DeleteViewDialog";
import type { BoardConfig } from "./DataViewsBoard";
import type { DataViewExport } from "./data-views-export";
import type { ScopeConfig } from "./data-views-scopes";
import { ViewDialogs, ViewMutationErrorAlert } from "./data-views-table-parts";
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
  /** A selection-widening control beside the count (e.g. "select all matching"). */
  selectionExtra?: SelectionExtraRender<T>;
  /** Bespoke per-row menu (an entity's self-contained 3-dots menu) instead of the auto kebab. */
  renderRowMenu?: (row: T) => React.ReactNode;
  /** Opt-in "Grade" (cards) layout — a card renderer per row; adds a Grade/Tabela toggle. */
  renderCard?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** Opt-in "Quadro" (board) layout — the loaded page as columns of one field. Needs `renderCard`. */
  board?: BoardConfig<T>;
  /** Opt-in "Lista" layout — one full-width, entity-rendered row per record (FUT-733). */
  renderListRow?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /** The Lista's shared columns, so its rows line up by construction not convention. */
  listGroup?: ListGroupConfig<T>;
  /** The page-level partition rendered as tabs under the toolbar (server mode only). */
  scopes?: ScopeConfig[];
  /** The row field the scopes partition by — used only to reject a pill over the same field. */
  scopeFieldId?: string;
  /** Which layout to show first when the user has expressed no preference (default "table"). */
  defaultLayout?: DataViewsLayout;
  /**
   * Ignore the remembered cross-screen layout preference and pin to
   * `defaultLayout`. For tables that exist to SHOW a layout — stories, docs,
   * screenshots — not for real screens.
   */
  ignoreStoredLayout?: boolean;
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
 * The Exibir panel's view chrome, assembled from the saved-views controller.
 * Extracted so {@link DataViewsTableBase} stays inside its size budget.
 */
function buildDisplayView({
  ctl,
  views,
  activeView,
  dirty,
  onRequestDelete,
}: {
  ctl: SavedViewsController;
  views: SavedViewSummary[];
  activeView: SavedViewSummary | undefined;
  dirty: boolean;
  /** Opens the confirmation; the delete itself happens on confirm. */
  onRequestDelete: (view: SavedViewSummary) => void;
}): DisplayPanelView {
  return {
    activeViewName: ctl.activeViewName,
    dirty,
    onReset: () => (activeView ? ctl.applyView(activeView) : ctl.selectMain()),
    // Only offer "Atualizar" when there IS a view to update — otherwise the
    // single footer button is a plain "Salvar visão".
    onUpdate: activeView ? () => ctl.openEdit(activeView) : undefined,
    onSaveAs: ctl.openCreate,
    // The views themselves, not a dropdown: the panel renders them in its own
    // body (see `data-views-view-nav`), so there is no second popover to clip
    // the row actions.
    nav: {
      views,
      activeViewId: activeView?.id ?? null,
      onSelectView: (id) => {
        const next = id === null ? null : views.find((view) => view.id === id);
        if (next) ctl.applyView(next);
        else ctl.selectMain();
      },
      onEditView: ctl.openEdit,
      onPatchView: (view, changes) => void ctl.patchView(view, changes),
      onDeleteView: onRequestDelete,
    },
  };
}

/**
 * "Are there unsaved changes?" — the dot on Exibir, and whether Redefinir and
 * Salvar visão are live.
 *
 * Two things it gets right that the inline version did not. It compares
 * NORMALISED states (`viewStateKey`), so a filter applied and then removed is
 * clean again rather than clean-looking but flagged; and it re-baselines after
 * a SAVE, because the state just written is the clean one from that point.
 *
 * The baseline is the first state the grid emits for a view, not the view
 * itself: the grid normalises what it is handed — resolving visible columns,
 * filling in layout — so the applied view is never byte-identical to the state
 * it produces.
 */
function useDirtyTracking(ctl: SavedViewsController): {
  dirty: boolean;
  noteState: (state: DataViewState) => void;
  markSaved: () => void;
} {
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const baseline = useRef<string | null>(null);
  const appliedKey = JSON.stringify(ctl.applied ?? null);

  useEffect(() => {
    baseline.current = null;
    setDirty(false);
  }, [appliedKey, savedAt]);

  return {
    dirty,
    noteState: (state) => {
      ctl.currentRef.current = state;
      const key = viewStateKey(state);
      if (baseline.current === null) {
        baseline.current = key;
        setDirty(false);
        return;
      }
      const next = key !== baseline.current;
      setDirty((prev) => (prev === next ? prev : next));
    },
    markSaved: () => setSavedAt((tick) => tick + 1),
  };
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
  // Unsaved-changes flag for the Exibir panel. Set from `onStateChange` rather
  // than derived in render because the live state lives in a REF (the grid owns
  // it); the equality bail-out in `setDirty` is what stops the update loop.
  const { dirty, noteState, markSaved } = useDirtyTracking(ctl);
  // Deleting a saved view is confirmed, not immediate — see `DeleteViewDialog`.
  const [pendingDelete, setPendingDelete] = useState<SavedViewSummary | null>(null);
  // The view the panel's "Redefinir" restores: the applied one, or the built-in
  // "Visão principal" when none is.
  const activeView = views.find((view) => view.name === ctl.activeViewName);
  const displayView = buildDisplayView({
    ctl,
    views,
    activeView,
    dirty,
    onRequestDelete: setPendingDelete,
  });
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
        onStateChange={noteState}
        // The saved-views menu is NOT a toolbar control any more: it lives in
        // the Exibir panel's VISÃO header, passed through `displayView`.
        displayView={displayView}
      />
      {renderViewDialogs(ctl, fields, columns, views, testIdPrefix, markSaved)}
      <DeleteViewDialog
        view={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={(view) => {
          void ctl.handleDelete(view);
          setPendingDelete(null);
        }}
        testIdPrefix={testIdPrefix}
      />
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
  onSaved: () => void,
): React.JSX.Element {
  return (
    <ViewDialogs<T>
      saveOpen={ctl.saveOpen}
      onCloseSave={ctl.closeSave}
      currentState={ctl.editing ? ctl.editing.state : ctl.currentRef.current}
      fields={fields}
      columns={columns}
      editing={ctl.editing}
      onSave={async (payload) => {
        await ctl.handleSave(payload);
        // The saved state is the clean one from here on.
        onSaved();
      }}
      manageOpen={ctl.manageOpen}
      onCloseManage={() => ctl.setManageOpen(false)}
      views={views}
      onEditFromManage={ctl.editFromManage}
      onDelete={(view) => void ctl.handleDelete(view)}
      testIdPrefix={testIdPrefix}
    />
  );
}
