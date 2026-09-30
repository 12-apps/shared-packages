import type React from "react";

import type { GridRowExpansion } from "../DataGrid";
import type { DataViewsCopy } from "./data-views-copy";

/**
 * A detail that opens UNDER a table row — a sub-table, say — behind a chevron
 * in its own leading column.
 *
 * TABLE layout only. The cards, the list and the board draw no chevron: each is
 * an entity-rendered surface with its own way of showing more, and a second
 * disclosure beside that one would compete with it.
 */
export interface DataViewRowDetail<T> {
  /** The detail for one row. Rendered only while that row is expanded. */
  render: (row: T) => React.ReactNode;
  /**
   * Which rows HAVE a detail. Omitted, every row does. A refused row keeps an
   * empty chevron cell, so the columns stay aligned, but offers nothing to open.
   */
  isExpandable?: (row: T) => boolean;
}

/**
 * The DataGrid `expansion` a `rowDetail` becomes. The chevron speaks the SAME
 * words the list card's disclosure does, so the two layouts name the one
 * gesture identically in every locale.
 */
export function toGridExpansion<T extends Record<string, unknown>>(
  rowDetail: DataViewRowDetail<T> | undefined,
  copy: DataViewsCopy,
): GridRowExpansion<T> | undefined {
  if (!rowDetail) return undefined;
  return {
    render: (row) => rowDetail.render(row),
    isRowExpandable: rowDetail.isExpandable,
    expandLabel: copy.selection.expandRow,
    collapseLabel: copy.selection.collapseRow,
  };
}
