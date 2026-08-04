"use client";

import type { MutableRefObject } from "react";

import type {
  DataViewPersistence,
  DataViewSaveInput,
  DataViewState,
  SavedViewSummary,
} from "./data-views-types";
import { type SaveViewPayload } from "./SaveViewModal";

export interface ViewMutations {
  handleSave: (payload: SaveViewPayload) => Promise<void>;
  patchView: (
    view: SavedViewSummary,
    changes: Partial<Pick<SavedViewSummary, "isDefault" | "pinned" | "shared">>,
  ) => Promise<void>;
  handleDelete: (view: SavedViewSummary) => Promise<void>;
}

/** The SavedView persistence handlers (create/update/delete), via injected `persistence`. */
export function useViewMutations(
  persistence: DataViewPersistence,
  editing: SavedViewSummary | null,
  currentRef: MutableRefObject<DataViewState>,
  onDone: (ok: boolean, error?: string) => void,
): ViewMutations {
  async function handleSave(payload: SaveViewPayload): Promise<void> {
    const state = editing ? editing.state : currentRef.current;
    const input: DataViewSaveInput = {
      name: payload.name,
      description: payload.description,
      state,
      shared: payload.shared,
      pinned: payload.pinned,
      isDefault: payload.isDefault,
    };
    const result = editing ? await persistence.update(editing.id, input) : await persistence.create(input);
    // Fail loudly on a rejected save (e.g. duplicate name) so the modal stays
    // open and shows the error instead of closing as if it succeeded.
    if (!result.ok) throw new Error(result.error);
    onDone(true);
  }

  async function patchView(
    view: SavedViewSummary,
    changes: Partial<Pick<SavedViewSummary, "isDefault" | "pinned" | "shared">>,
  ): Promise<void> {
    const next = { ...view, ...changes };
    const result = await persistence.update(view.id, {
      name: next.name,
      description: next.description ?? "",
      state: next.state,
      shared: next.shared,
      pinned: next.pinned,
      isDefault: next.isDefault,
    });
    onDone(result.ok, result.ok ? undefined : result.error);
  }

  async function handleDelete(view: SavedViewSummary): Promise<void> {
    const result = await persistence.remove(view.id);
    onDone(result.ok, result.ok ? undefined : result.error);
  }

  return { handleSave, patchView, handleDelete };
}
