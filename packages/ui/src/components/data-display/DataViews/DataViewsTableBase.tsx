"use client";

import type { SortFieldDefinition } from "../../layout/ContentToolbar";
import { useMemo, useRef, useState } from "react";

import { DataViewsGrid } from "./DataViewsGrid";
import { ViewDialogs, ViewMutationErrorAlert, ViewsMenuSlot } from "./data-views-table-parts";
import { useViewMutations, type ViewMutations } from "./data-views-view-mutations";
import {
  coerceViewState,
  emptyViewState,
  type DataViewColumn,
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
import { type SaveViewPayload } from "./SaveViewModal";

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
  /** Which layout to show first when cards are available (default "table"). */
  defaultLayout?: "cards" | "table";
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

interface SavedViewsController {
  applied: DataViewState;
  /** Name of the currently-applied saved view, if any (drives the trigger label). */
  activeViewName?: string;
  /** Reset to the built-in no-filter "Main vision" default (clears the URL param). */
  selectMain: () => void;
  currentRef: React.MutableRefObject<DataViewState>;
  saveOpen: boolean;
  editing: SavedViewSummary | null;
  manageOpen: boolean;
  setSaveOpen: (open: boolean) => void;
  setEditing: (view: SavedViewSummary | null) => void;
  setManageOpen: (open: boolean) => void;
  applyView: (view: SavedViewSummary) => void;
  openCreate: () => void;
  openEdit: (view: SavedViewSummary) => void;
  /** Close the save modal and clear the editing target. */
  closeSave: () => void;
  /** Close the manage dialog and open the edit modal for `view`. */
  editFromManage: (view: SavedViewSummary) => void;
  patchView: ViewMutations["patchView"];
  handleDelete: ViewMutations["handleDelete"];
  handleSave: (payload: SaveViewPayload) => Promise<void>;
  /** Last pin/share/default/delete failure — shown as an Alert, never silent. */
  mutationError: string | null;
  clearMutationError: () => void;
}

interface AppliedView {
  applied: DataViewState;
  currentRef: React.MutableRefObject<DataViewState>;
  activeViewName?: string;
  applyView: (view: SavedViewSummary) => void;
  selectMain: () => void;
}

/**
 * The applied grid state + which saved view it came from, kept in sync with the
 * URL (`?view=<id>`) so a refresh restores it. "Main vision" resets + clears it.
 */
function useAppliedView(
  router: DataViewRouter,
  columnIds: string[],
  views: SavedViewSummary[],
  initialView: SavedViewSummary | undefined,
  initialState: DataViewState | undefined,
): AppliedView {
  // A saved view wins; otherwise seed from the host-supplied initial state (e.g.
  // filters/sort read off the URL, FUT-180) so a bookmarked filtered URL is
  // reflected in the grid — column visibility isn't URL-carried, so show all.
  const seed = initialView
    ? coerceViewState(initialView.state, columnIds)
    : initialState
      ? { ...initialState, visibleColumns: columnIds }
      : emptyViewState(columnIds);
  const [applied, setApplied] = useState<DataViewState>(seed);
  const [appliedViewId, setAppliedViewId] = useState<string | null>(initialView?.id ?? null);
  const currentRef = useRef<DataViewState>(seed);

  const applyView = (view: SavedViewSummary): void => {
    setApplied(coerceViewState(view.state, columnIds));
    setAppliedViewId(view.id);
    router.syncViewParam(view.id);
  };
  const selectMain = (): void => {
    setApplied(emptyViewState(columnIds));
    setAppliedViewId(null);
    router.syncViewParam(null);
  };
  const activeViewName = views.find((view) => view.id === appliedViewId)?.name;
  return { applied, currentRef, activeViewName, applyView, selectMain };
}

/**
 * Owns the saved-views state + persistence for {@link DataViewsTable}: the applied
 * grid state, the live-state ref, the modal/dialog flags, and the create/edit/
 * delete/patch handlers. Extracted so the component render stays within budget.
 */
function useSavedViewsController(
  persistence: DataViewPersistence,
  router: DataViewRouter,
  columnIds: string[],
  views: SavedViewSummary[],
  initialView: SavedViewSummary | undefined,
  initialState: DataViewState | undefined,
): SavedViewsController {
  const { applied, currentRef, activeViewName, applyView, selectMain } =
    useAppliedView(router, columnIds, views, initialView, initialState);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState<SavedViewSummary | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const openCreate = (): void => {
    setEditing(null);
    setSaveOpen(true);
  };
  const openEdit = (view: SavedViewSummary): void => {
    setEditing(view);
    setSaveOpen(true);
  };

  const [mutationError, setMutationError] = useState<string | null>(null);
  const refreshAfter = (ok: boolean, error?: string): void => {
    if (ok) {
      setMutationError(null);
      router.refresh();
    } else {
      // A rejected pin/share/default/delete must be visible (FUT-100) — the
      // menus close on click, so an inline Alert is the only surviving signal.
      setMutationError(error ?? "Não foi possível salvar a alteração da visão.");
    }
  };

  const { handleSave: saveView, patchView, handleDelete } = useViewMutations(
    persistence,
    editing,
    currentRef,
    refreshAfter,
  );

  const handleSave = async (payload: SaveViewPayload): Promise<void> => {
    await saveView(payload);
    setSaveOpen(false);
    setEditing(null);
  };

  return {
    applied,
    activeViewName,
    selectMain,
    currentRef,
    saveOpen,
    editing,
    manageOpen,
    setSaveOpen,
    setEditing,
    setManageOpen,
    applyView,
    openCreate,
    openEdit,
    closeSave: () => {
      setSaveOpen(false);
      setEditing(null);
    },
    editFromManage: (view: SavedViewSummary) => {
      setManageOpen(false);
      openEdit(view);
    },
    patchView,
    handleDelete,
    handleSave,
    mutationError,
    clearMutationError: () => setMutationError(null),
  };
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
export function DataViewsTableBase<T extends Record<string, unknown>>({
  initialViewId = null,
  persistence,
  router,
  rows,
  columns,
  fields,
  rangeFields,
  getRowId,
  onRowClick,
  emptyState,
  dataTestId,
  testIdPrefix = "table",
  views,
  title,
  headerActions,
  sortFields,
  onVisibleRowsChange,
  rowActions,
  rowActionsLeading,
  bulkActions,
  renderRowMenu,
  renderCard,
  defaultLayout,
  inlineFilters,
  alwaysShowSearch,
  server,
  initialState,
}: DataViewsTableBaseProps<T>): React.JSX.Element {
  const initialView = resolveInitialView(views, initialViewId);
  const columnIds = columns.map((col) => col.id);
  const ctl = useSavedViewsController(persistence, router, columnIds, views, initialView, initialState);
  // Server-mode lists re-apply URL-derived controls on back/forward (not just the mount seed).
  const syncState = useUrlSyncState(server, initialState);

  return (
    <>
      <ViewMutationErrorAlert error={ctl.mutationError} onClose={ctl.clearMutationError} testIdPrefix={testIdPrefix} />
      <DataViewsGrid<T>
        rows={rows}
        columns={columns}
        fields={fields}
        rangeFields={rangeFields}
        getRowId={getRowId}
        onRowClick={onRowClick}
        emptyState={emptyState}
        dataTestId={dataTestId}
        testIdPrefix={testIdPrefix}
        title={title}
        headerActions={headerActions}
        sortFields={sortFields}
        rowActions={rowActions}
        rowActionsLeading={rowActionsLeading}
        bulkActions={bulkActions}
        renderRowMenu={renderRowMenu}
        renderCard={renderCard}
        defaultLayout={defaultLayout}
        inlineFilters={inlineFilters}
        alwaysShowSearch={alwaysShowSearch}
        server={server}
        appliedState={ctl.applied}
        syncState={syncState}
        onStateChange={(state) => (ctl.currentRef.current = state)}
        onVisibleRowsChange={onVisibleRowsChange}
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
