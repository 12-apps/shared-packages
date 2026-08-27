/**
 * The selection-WIDENING slot: what a paginated grid needs so an operator can
 * act on "everything matching the filter" rather than on the page in front of
 * them.
 *
 * It is a slot of its own rather than a share of the bulk-actions menu because
 * the two answer different questions — `actions` is what HAPPENS to the
 * selection, this is what the selection IS. Folding a widening into the actions
 * menu files "change what I picked" under "do this to what I picked", where
 * every entry is expected to write something.
 */
import type { DataViewsController } from "./use-data-views-state";

/**
 * What a widening control gets to decide with.
 *
 * `allOnPageSelected` is the one thing a host cannot compute for itself, and
 * the whole reason this is a context rather than a bare node: the grid owns
 * which rows the page is currently rendering — server mode pages at the
 * backend, so the host's `rows` prop and the page can differ mid-fetch — and
 * "every row here is ticked" is the trigger a select-all-matching control
 * hangs on. Deriving it host-side would be a second, slightly different answer
 * to the question the grid already answers to draw its own header checkbox.
 */
export interface SelectionExtraContext<T extends Record<string, unknown>> {
  /** The selected rows, off-page ones included. */
  selectedRows: T[];
  /** Drop the whole selection. */
  clearSelection: () => void;
  /** Every row the page is rendering is selected — and the page is not empty. */
  allOnPageSelected: boolean;
  /** How many rows the page is rendering. */
  pageRowCount: number;
}

/** The host's widening control, called only while something is selected. */
export type SelectionExtraRender<T extends Record<string, unknown>> = (
  context: SelectionExtraContext<T>,
) => React.ReactNode;

/**
 * Resolve the host's control against the page on screen.
 *
 * Measured against `c.matched` — which in server mode IS the page — rather than
 * the `rows` prop, so the answer cannot lag a page change.
 *
 * Returns `undefined` with nothing selected, so the toolbar renders no empty
 * slot: a widening with nothing to widen is not a control.
 */
export function resolveSelectionExtra<T extends Record<string, unknown>>({
  c,
  getRowId,
  selectionExtra,
}: {
  c: DataViewsController<T>;
  getRowId: (row: T) => string | number;
  selectionExtra?: SelectionExtraRender<T>;
}): React.ReactNode {
  if (selectionExtra === undefined || c.selectedRows.length === 0) return undefined;
  const page = c.matched;
  return selectionExtra({
    selectedRows: c.selectedRows,
    clearSelection: c.clearSelection,
    allOnPageSelected: page.length > 0 && page.every((row) => c.selectedIds.has(getRowId(row))),
    pageRowCount: page.length,
  });
}
