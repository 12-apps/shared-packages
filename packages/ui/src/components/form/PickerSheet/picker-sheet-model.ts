import type { PickerSheetItem } from './PickerSheet.types';

/** What the list shows for a query: the matching items, and whether a create row follows them. */
export interface PickerSheetView {
  /** The trimmed query. */
  query: string;
  items: PickerSheetItem[];
  /** True when the create row is offered as the last row. */
  canCreate: boolean;
  /** Rows the keyboard cursor walks: every matching item, plus the create row. */
  rowCount: number;
}

/** The text an item is matched on, lower-cased. */
function haystack(item: PickerSheetItem): string {
  return (item.searchText ?? `${item.label} ${item.meta ?? ''}`).toLowerCase();
}

/** Case-insensitive substring match on each item's `searchText`. An empty query keeps everything. */
function filterPickerItems(items: PickerSheetItem[], query: string): PickerSheetItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => haystack(item).includes(needle));
}

/** True when some item's LABEL is exactly the query, case aside — creating it would duplicate it. */
function hasExactLabel(items: PickerSheetItem[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  return items.some((item) => item.label.trim().toLowerCase() === needle);
}

/** The list for a query, and whether it ends in a create row. */
export function pickerSheetView(
  items: PickerSheetItem[],
  rawQuery: string,
  creatable: boolean,
): PickerSheetView {
  const query = rawQuery.trim();
  const matches = filterPickerItems(items, query);
  const canCreate = creatable && query.length > 0 && !hasExactLabel(items, query);
  return { query, items: matches, canCreate, rowCount: matches.length + (canCreate ? 1 : 0) };
}

/**
 * The keyboard cursor after an arrow key — the `Command` model: it wraps at
 * both ends, and from "no row" Down lands on the first row and Up on the last.
 */
export function stepActiveIndex(current: number, delta: 1 | -1, rowCount: number): number {
  if (rowCount === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : rowCount - 1;
  return (current + delta + rowCount) % rowCount;
}
