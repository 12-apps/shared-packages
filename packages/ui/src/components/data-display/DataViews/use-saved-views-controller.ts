"use client";

import { useRef, useState } from "react";

import { useDataViewsCopy } from "./data-views-copy-context";
import { useViewMutations, type ViewMutations } from "./data-views-view-mutations";
import {
  coerceViewState,
  emptyViewState,
  type DataViewPersistence,
  type DataViewRouter,
  type DataViewState,
  type SavedViewSummary,
} from "./data-views-types";
import { type SaveViewPayload } from "./SaveViewModal";

export interface SavedViewsController {
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
export function useSavedViewsController(
  persistence: DataViewPersistence,
  router: DataViewRouter,
  columnIds: string[],
  views: SavedViewSummary[],
  initialView: SavedViewSummary | undefined,
  initialState: DataViewState | undefined,
): SavedViewsController {
  const copy = useDataViewsCopy();
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
      setMutationError(error ?? copy.nav.saveFailed);
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

