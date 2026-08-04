/**
 * The DataGrid's CLIENT-MODE row pipeline: filter, sort, paginate.
 *
 * Lifted out of the component so it is a pure function of its inputs — no
 * hooks, no theme, no refs — which is the only way the comparator can be read
 * (and tested) at all. Server modes skip every step here: the rows arrived
 * already filtered, sorted and paged, and re-doing any of it locally would make
 * the grid disagree with the page count the server just sent.
 */
import type { GridColumn, GridFilter, GridSort } from './DataGrid.types';

/** The value a column reads out of a row: accessor fn, accessor key, or id. */
export function cellValue<T extends Record<string, unknown>>(
  row: T,
  column: GridColumn<T>,
): unknown {
  const { accessor } = column;
  if (typeof accessor === 'function') return accessor(row);
  if (accessor !== undefined) return row[accessor];
  return row[column.id];
}

/**
 * Order two cell values, with absent ones sorting first.
 *
 * Numbers compare as numbers and everything else as a string — the grid has no
 * per-column comparator, and stringifying a number would sort 10 before 9.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const left = typeof a === 'number' ? a : String(a);
  const right = typeof b === 'number' ? b : String(b);
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * A comparator over the whole `sortBy` list — earlier entries win, later ones
 * break their ties. A sort entry naming an unknown column, or carrying a `null`
 * direction, is skipped rather than treated as ascending.
 */
function makeComparator<T extends Record<string, unknown>>(
  sortBy: readonly GridSort[],
  columnMap: ReadonlyMap<string, GridColumn<T>>,
): (a: T, b: T) => number {
  return (a, b) => {
    for (const sort of sortBy) {
      const column = columnMap.get(sort.id);
      if (!column || !sort.dir) continue;
      const comparison = compareValues(cellValue(a, column), cellValue(b, column));
      if (comparison !== 0) return sort.dir === 'desc' ? -comparison : comparison;
    }
    return 0;
  };
}

/** Does `row` satisfy one filter? An unknown column or empty value matches all. */
function matchesFilter<T extends Record<string, unknown>>(
  row: T,
  filter: GridFilter,
  columnMap: ReadonlyMap<string, GridColumn<T>>,
): boolean {
  const column = columnMap.get(filter.id);
  if (!column || !filter.value) return true;
  const value = cellValue(row, column);
  if (column.filterPredicate) return column.filterPredicate(value, filter.value, row);
  return String(value ?? '')
    .toLowerCase()
    .includes(String(filter.value).toLowerCase());
}

/** Which client-mode steps this render actually needs. */
interface RowPipeline<T extends Record<string, unknown>> {
  rows: T[];
  columnMap: ReadonlyMap<string, GridColumn<T>>;
  filters: readonly GridFilter[];
  sortBy: readonly GridSort[];
  needsFiltering: boolean;
  needsSorting: boolean;
  needsPagination: boolean;
  pageIndex: number;
  pageSize: number;
}

/**
 * Run the pipeline, copying the array only when a step actually has to modify
 * it. The identity of the untouched array is load-bearing: the grid's memos and
 * every consumer's `rows === prev` check depend on a no-op pipeline returning
 * exactly what it was given.
 */
export function processRows<T extends Record<string, unknown>>(pipeline: RowPipeline<T>): T[] {
  const { rows, columnMap, needsFiltering, needsSorting, needsPagination } = pipeline;
  if (!needsFiltering && !needsSorting && !needsPagination) return rows;

  let result = rows;
  if (needsFiltering) {
    result = result.filter((row) =>
      pipeline.filters.every((filter) => matchesFilter(row, filter, columnMap)),
    );
  }
  if (needsSorting) {
    // Copy only here: `Array#sort` is in-place and the caller owns `rows`.
    result = [...result].sort(makeComparator(pipeline.sortBy, columnMap));
  }
  if (needsPagination) {
    const start = pipeline.pageIndex * pipeline.pageSize;
    result = result.slice(start, start + pipeline.pageSize);
  }
  return result;
}
