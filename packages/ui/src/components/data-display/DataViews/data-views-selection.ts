"use client";

import { useMemo, useRef, useState } from "react";

/** The multi-select model, identical in every layout (table, cards, board). */
interface DataViewsSelection<T> {
  selectedIds: Set<string | number>;
  setSelectedIds: (ids: Set<string | number>) => void;
  /** Add/remove ONE id — what a card's or board card's checkbox calls. */
  toggleId: (id: string | number) => void;
  /** The selected rows, INCLUDING ones the current page no longer renders. */
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
 *
 * ## A selection has to survive PAGING
 *
 * `selectedIds` always did — nothing clears it when the page changes — but
 * `selectedRows` was `matched.filter(...)`, and in SERVER mode `matched` is one
 * page. So ticking three rows, paging, and ticking two more left the checkboxes
 * claiming five and the bulk action receiving two, silently, with the other
 * three still ticked on a page nobody was looking at.
 *
 * That is the worst shape a bug can have here: the UI and the write disagree,
 * neither says so, and the rows that did not move are exactly the ones out of
 * sight. So a row is REMEMBERED for as long as its id is selected, and
 * `selectedRows` answers from that memory for anything the current page does
 * not hold.
 *
 * **Server mode only** ({@link SelectionOptions.rememberOffPage}), and the
 * distinction is not a hedge. In client mode `matched` is the whole filtered
 * result, so nothing is ever off-page and there is nothing to remember — while
 * narrowing the selection as the FILTER narrows is the behaviour a client-mode
 * grid should keep. Remembering there would mean a bulk action reaching rows
 * the operator has just filtered away.
 */
export interface SelectionOptions {
  /**
   * Keep rows the current page no longer renders.
   *
   * True in server mode, where `matched` is a page rather than the result.
   */
  rememberOffPage?: boolean;
}

export function useSelection<T>(
  matched: T[],
  getRowId: (row: T) => string | number,
  options: SelectionOptions = {},
): DataViewsSelection<T> {
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  // Rows seen while selected, so a selection outlives the page that made it.
  // A ref rather than state: it is a CACHE derived from what has been rendered,
  // and holding it in state would re-render on every page load to store rows
  // nothing is waiting for.
  const remembered = useRef(new Map<string | number, T>());

  const selectedRows = useMemo(() => {
    const onPage = matched.filter((row) => selectedIds.has(getRowId(row)));
    if (!options.rememberOffPage) return onPage;

    const cache = remembered.current;
    // Refresh from what is on screen NOW: a row edited elsewhere and re-fetched
    // must not be acted on through a stale snapshot from three pages ago.
    for (const row of onPage) cache.set(getRowId(row), row);
    // …and forget anything no longer selected, so the map cannot outgrow the
    // selection it exists to describe.
    for (const id of cache.keys()) if (!selectedIds.has(id)) cache.delete(id);

    // On-page rows first, in the page's own order — unchanged from before this
    // — then the remembered tail. Appending rather than interleaving keeps the
    // familiar case byte-identical and makes the addition exactly the addition.
    const onPageIds = new Set(onPage.map(getRowId));
    const offPage = [...cache.entries()].flatMap(([id, row]) =>
      onPageIds.has(id) ? [] : [row],
    );
    return [...onPage, ...offPage];
  }, [matched, selectedIds, getRowId, options.rememberOffPage]);

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
