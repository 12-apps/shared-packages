import type { DataViewState, RangeValue } from "./data-views-types";

/**
 * A comparable key for a view state — the answer to "has anything changed?".
 *
 * `JSON.stringify(state)` is not that answer. Clearing a filter does not remove
 * its entry, it leaves an EMPTY one (`pills: { pagamento: [] }`), and an emptied
 * range leaves `{}` behind; both stringify differently from the state that never
 * had them, so a filter applied and then removed left the view reading "unsaved
 * changes" over a state identical to the one it started from. The only way back
 * was "Redefinir", which is the operator undoing something they had already
 * undone.
 *
 * So: drop what is empty, sort what is unordered, and keep what actually
 * distinguishes one view from another.
 */

/** Is this range bounded at either end? An empty one is not a constraint. */
function isSet(range: RangeValue | undefined): boolean {
  return Boolean(range && (range.min !== undefined || range.max !== undefined));
}

/** Selected values, sorted — picking A then B is the same view as B then A. */
function normalizePills(pills: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(pills ?? {}).sort()) {
    const values = pills?.[key];
    if (values && values.length > 0) out[key] = [...values].sort();
  }
  return out;
}

function normalizeRanges(
  ranges: Record<string, RangeValue> | undefined,
): Record<string, RangeValue> {
  const out: Record<string, RangeValue> = {};
  for (const key of Object.keys(ranges ?? {}).sort()) {
    const range = ranges?.[key];
    if (isSet(range)) out[key] = range as RangeValue;
  }
  return out;
}

/**
 * Everything a saved view stores, in a stable shape.
 *
 * `visibleColumns` is SORTED — it is a set, and its array order carries no
 * meaning (reading order lives in `order`). `order` is not sorted, for the
 * opposite reason.
 */
export function viewStateKey(state: DataViewState): string {
  return JSON.stringify({
    search: state.search.trim(),
    pills: normalizePills(state.pills),
    ranges: normalizeRanges(state.ranges),
    sortBy: state.sortBy ?? [],
    visibleColumns: [...(state.visibleColumns ?? [])].sort(),
    order: state.order ?? null,
    scope: state.scope ?? null,
    layout: state.layout ?? null,
  });
}
