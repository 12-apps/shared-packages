import type { GridColumn } from "../DataGrid";

import type {
  DataViewColumn,
  FilterFieldConfig,
  RangeFieldConfig,
  RangeValue,
} from "./data-views-types";

/**
 * Pure filtering for the DataViews table (FUT-88) — kept out of the component so
 * the search + pill semantics are unit-testable in isolation. The grid does its
 * own sorting + column hiding; this narrows the row set (and drives the "showing
 * X of Y" counter), so all filtering lives here in one place.
 */

/** Resolve a column's raw value for a row (function accessor, key, or id fallback). */
function resolveColumnValue<T extends Record<string, unknown>>(
  row: T,
  col: Pick<GridColumn<T>, "accessor" | "id">,
): unknown {
  const { accessor, id } = col;
  if (typeof accessor === "function") return accessor(row);
  if (accessor) return row[accessor];
  return row[id as keyof T];
}

function matchesSearch<T extends Record<string, unknown>>(
  row: T,
  searchableColumns: DataViewColumn<T>[],
  term: string,
): boolean {
  if (!term) return true;
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return searchableColumns.some((col) => {
    const value = resolveColumnValue(row, col);
    return value != null && String(value).toLowerCase().includes(q);
  });
}

function matchesPills<T extends Record<string, unknown>>(
  row: T,
  fields: FilterFieldConfig<T>[],
  pills: Record<string, string[]>,
): boolean {
  return fields.every((field) => {
    const selected = pills[field.id];
    if (!selected || selected.length === 0) return true;
    const raw = field.accessor ? field.accessor(row) : row[field.id];
    const values = Array.isArray(raw) ? raw.map((v) => String(v)) : [String(raw ?? "")];
    return values.some((value) => selected.includes(value));
  });
}

/**
 * Is this range an active filter? A missing range, one with no bounds, or an
 * inverted one (max < min, which is invalid) is inactive — an inactive range
 * never filters anything out; the UI surfaces the inverted case as an error.
 */
function isRangeActive(range: RangeValue | undefined): range is RangeValue {
  if (!range || (range.min == null && range.max == null)) return false;
  if (range.min != null && range.max != null && range.max < range.min) return false;
  return true;
}

/** Does one value satisfy a single (possibly one-sided) numeric range? */
function rangeAllows(range: RangeValue | undefined, value: number | null | undefined): boolean {
  if (!isRangeActive(range)) return true;
  // A row without a comparable number can't satisfy a bounded range.
  if (value == null || Number.isNaN(value)) return false;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}

/** Does the row fall within every bounded numeric range? */
function matchesRanges<T extends Record<string, unknown>>(
  row: T,
  rangeFields: RangeFieldConfig<T>[],
  ranges: Record<string, RangeValue>,
): boolean {
  return rangeFields.every((field) => rangeAllows(ranges[field.id], field.accessor(row)));
}

/**
 * The rows matching the current search + pill selections + numeric ranges
 * (order unchanged). `rangeFields` is optional so existing multi-select-only
 * tables call this unchanged.
 */
export function filterRows<T extends Record<string, unknown>>(
  rows: T[],
  columns: DataViewColumn<T>[],
  fields: FilterFieldConfig<T>[],
  criteria: { search: string; pills: Record<string, string[]>; ranges?: Record<string, RangeValue> },
  rangeFields: RangeFieldConfig<T>[] = [],
): T[] {
  const searchable = columns.filter((col) => col.searchable);
  const ranges = criteria.ranges ?? {};
  return rows.filter(
    (row) =>
      matchesSearch(row, searchable, criteria.search) &&
      matchesPills(row, fields, criteria.pills) &&
      matchesRanges(row, rangeFields, ranges),
  );
}
