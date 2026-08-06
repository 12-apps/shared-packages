"use client";

import { useMemo, useState } from "react";

/** The multi-select model, identical in every layout (table, cards, board). */
export interface DataViewsSelection<T> {
  selectedIds: Set<string | number>;
  setSelectedIds: (ids: Set<string | number>) => void;
  /** Add/remove ONE id — what a card's or board card's checkbox calls. */
  toggleId: (id: string | number) => void;
  /** The selected rows, narrowed to what is currently rendered. */
  selectedRows: T[];
  clearSelection: () => void;
  selectAll: () => void;
}

/**
 * Owns the DataViews selection. ONE set of ids across every layout, so switching
 * from the board to the table (or to the cards) keeps exactly the same rows
 * selected and offers exactly the same bulk actions.
 *
 * Extracted from {@link useDataViewsState} for that hook's size budget, and
 * because `toggleId` needs a functional update: two cards toggled in the same
 * tick would otherwise both read the pre-render set and the second would drop
 * the first's change.
 */
export function useSelection<T>(
  matched: T[],
  getRowId: (row: T) => string | number,
): DataViewsSelection<T> {
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const selectedRows = useMemo(
    () => matched.filter((row) => selectedIds.has(getRowId(row))),
    [matched, selectedIds, getRowId],
  );
  return {
    selectedIds,
    setSelectedIds,
    toggleId: (id) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectedRows,
    clearSelection: () => setSelectedIds(new Set()),
    selectAll: () => setSelectedIds(new Set(matched.map((row) => getRowId(row)))),
  };
}
