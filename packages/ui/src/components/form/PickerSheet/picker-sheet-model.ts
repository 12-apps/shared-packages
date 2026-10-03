import { foldText } from '../CategorySelect/category-tree';
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

/**
 * The text an item is matched on, folded: its label always, then its
 * `searchText` (or its meta line). The label is never left out, so a row whose
 * label IS the query is always on screen — the create row it suppresses would
 * otherwise leave the list empty.
 */
function haystack(item: PickerSheetItem): string {
  return foldText(`${item.label} ${item.searchText ?? item.meta ?? ''}`);
}

/**
 * Substring match, case and accents aside: "acai" finds "Açaí", as it does in
 * `CategorySelect` — a hurried phone keyboard drops the accent, and a search
 * that then finds nothing offers to create a duplicate. An empty query keeps
 * everything but nothing hides.
 */
function filterPickerItems(items: PickerSheetItem[], query: string): PickerSheetItem[] {
  const needle = foldText(query.trim());
  if (!needle) return items;
  return items.filter((item) => !item.hideWhileSearching && haystack(item).includes(needle));
}

/** True when some item's LABEL is the query, case and accents aside — creating it would duplicate it. */
function hasExactLabel(items: PickerSheetItem[], query: string): boolean {
  const needle = foldText(query.trim());
  return items.some((item) => foldText(item.label.trim()) === needle);
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
