import { useMemo } from "react";

import { pinRowFirst } from "../DataGrid/DataGrid.rows";

/**
 * The pinned row (FUT-4745), resolved against the host's FULL `rows` — not the
 * filtered set — so a row the search or a pill would hide is still the one
 * pinned. Ids compare as strings, so `7` pins the row whose id is `"7"`.
 * `undefined` when nothing is pinned or the id matches no row.
 */
export function findPinnedRow<T>(
  rows: T[],
  getRowId: (row: T) => string | number,
  pinnedRowId: string | number | null | undefined,
): T | undefined {
  if (pinnedRowId === undefined || pinnedRowId === null) return undefined;
  const wanted = String(pinnedRowId);
  return rows.find((row) => String(getRowId(row)) === wanted);
}

/**
 * `matched` with the pinned row first: added when the filters dropped it,
 * moved when they kept it, never present twice. Without a pinned row the very
 * same array comes back, so every existing memo and `rows === prev` check sees
 * nothing change.
 */
export function usePinnedFirst<T>(
  matched: T[],
  rows: T[],
  getRowId: (row: T) => string | number,
  pinnedRowId: string | number | null | undefined,
): { matched: T[]; pinnedRow?: T } {
  const pinned = findPinnedRow(rows, getRowId, pinnedRowId);
  const ordered = useMemo(() => {
    if (pinned === undefined) return matched;
    const withPinned = matched.includes(pinned) ? matched : [pinned, ...matched];
    return pinRowFirst(withPinned, (row) => row === pinned);
  }, [matched, pinned]);
  return { matched: ordered, pinnedRow: pinned };
}
