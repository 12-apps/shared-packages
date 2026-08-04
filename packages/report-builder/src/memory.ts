import {
  accumulate,
  compareValues,
  finalize,
  newAccumulator,
  normalize,
  type Comparable,
  type MeasureAccumulator,
  type SourceRow,
} from './aggregates';
import { truncateDateToGrain } from './time';
import {
  isSuppressed,
  type CompiledDimension,
  type CompiledFilter,
  type CompiledQuery,
  type FilterValue,
  type ReportDataSource,
  type ReportRow,
} from './types';

/**
 * In-memory DataSource: executes the compiled IR over plain row arrays.
 * Reference implementation of the adapter contract (host adapters mirror its
 * semantics) and the workhorse of unit tests and toy hosts.
 */

function matchesRange(value: Comparable, filter: CompiledFilter): boolean {
  if (filter.operator === 'gte') return compareValues(value, filter.value as FilterValue) >= 0;
  if (filter.operator === 'lte') return compareValues(value, filter.value as FilterValue) <= 0;
  return (
    compareValues(value, filter.from as FilterValue) >= 0 &&
    compareValues(value, filter.to as FilterValue) <= 0
  );
}

function matchesFilter(row: SourceRow, filter: CompiledFilter): boolean {
  const value = normalize(row[filter.field]);
  switch (filter.operator) {
    case 'eq':
      return value === (filter.value as FilterValue);
    case 'neq':
      return value !== (filter.value as FilterValue);
    case 'in':
      return (filter.values ?? []).includes(value as FilterValue);
    case 'gte':
    case 'lte':
    case 'between':
      return value !== null && matchesRange(value, filter);
    default:
      return false;
  }
}

function bucketValue(
  row: SourceRow,
  dimension: CompiledDimension,
  timeZone: string,
): Comparable | null {
  const raw = row[dimension.field];
  if (raw === null || raw === undefined) return null;
  if (dimension.timeGrain) {
    return truncateDateToGrain(raw as string | number | Date, dimension.timeGrain, timeZone);
  }
  return normalize(raw);
}

interface Group {
  key: Array<Comparable | null>;
  accumulators: MeasureAccumulator[];
}

function groupRows(rows: SourceRow[], query: CompiledQuery): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = query.dimensions.map((dimension) => bucketValue(row, dimension, query.timeZone));
    const mapKey = JSON.stringify(key);
    let group = groups.get(mapKey);
    if (!group) {
      group = { key, accumulators: query.measures.map(newAccumulator) };
      groups.set(mapKey, group);
    }
    const { accumulators } = group;
    query.measures.forEach((measure, index) => {
      const accumulator = accumulators[index];
      if (accumulator) accumulate(accumulator, measure, row);
    });
  }
  return [...groups.values()];
}

function toReportRow(group: Group, query: CompiledQuery): ReportRow {
  const row: ReportRow = {};
  query.dimensions.forEach((dimension, index) => {
    row[dimension.alias] = group.key[index] ?? null;
  });
  query.measures.forEach((measure, index) => {
    const accumulator = group.accumulators[index];
    row[measure.alias] = accumulator ? finalize(measure, accumulator) : null;
  });
  return row;
}

/**
 * Ordering key for a cell. A SUPPRESSED cell sorts as a NULL: ranking it by
 * the value it is hiding would leak, through position alone, exactly what the
 * suppression exists to withhold.
 */
function sortableValue(value: ReportRow[string] | undefined): Comparable | null {
  if (value === undefined || isSuppressed(value)) return null;
  return value;
}

function sortRows(rows: ReportRow[], query: CompiledQuery): ReportRow[] {
  const orderings =
    query.sort.length > 0
      ? query.sort
      : query.dimensions.map((dimension) => ({ alias: dimension.alias, direction: 'asc' as const }));
  return [...rows].sort((a, b) => {
    for (const { alias, direction } of orderings) {
      const cmp = compareValues(sortableValue(a[alias]), sortableValue(b[alias]));
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

/** Execute a compiled query over in-memory rows (exported for host adapters
 * that fetch raw rows and fold in process). */
export function executeCompiledQuery(rows: SourceRow[], query: CompiledQuery): ReportRow[] {
  const filtered = rows.filter((row) => query.filters.every((filter) => matchesFilter(row, filter)));
  const grouped = groupRows(filtered, query).map((group) => toReportRow(group, query));
  return sortRows(grouped, query).slice(0, query.limit);
}

/** Build a DataSource over plain per-entity row arrays. */
export function createMemoryDataSource(tables: Record<string, SourceRow[]>): ReportDataSource {
  return {
    execute: (query) => Promise.resolve(executeCompiledQuery(tables[query.entity] ?? [], query)),
  };
}
