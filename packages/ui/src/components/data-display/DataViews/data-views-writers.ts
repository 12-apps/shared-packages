"use client";

import { type Dispatch, type SetStateAction } from "react";

import { type DataViewState, type DataViewStatePatch } from "./data-views-types";

/**
 * Add or remove one column id from the visible-columns list.
 *
 * Moved here with its only caller. A visible column is APPENDED rather than
 * restored to its original index, which is what makes re-showing a column put
 * it last — the behaviour the Exibir panel has always had.
 */
function nextVisibleColumns(current: string[], id: string, visible: boolean): string[] {
  const without = current.filter((colId) => colId !== id);
  return visible ? [...without, id] : without;
}

/**
 * The two ways a DataViews state is WRITTEN, spelled once.
 *
 * Both are `setState` with a shape — a whole-state patch, and the one column
 * toggle that has to merge into a list rather than replace a field. They sat
 * inline in `useDataViewsState`, which is permanently at the size gate's
 * ceiling; here they sit next to each other, where the fact that
 * `toggleColumn` is just a `patch` with a merge rule is visible.
 *
 * Extracted for the same reason `useSelection` was: that hook is a COMPOSITION
 * of the pieces below it, and every piece that can be named on its own leaves
 * it reading as what it assembles rather than as how each part works.
 */
export function useStateWriters(setState: Dispatch<SetStateAction<DataViewState>>): {
  patch: (next: DataViewStatePatch) => void;
  toggleColumn: (id: string, visible: boolean) => void;
} {
  return {
    patch: (next) =>
      setState((prev) => ({ ...prev, ...(typeof next === "function" ? next(prev) : next) })),
    toggleColumn: (id, visible) =>
      setState((prev) => ({
        ...prev,
        visibleColumns: nextVisibleColumns(prev.visibleColumns, id, visible),
      })),
  };
}
