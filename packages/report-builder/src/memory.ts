import {
  accumulate,
  compareValues,
  finalize,
  mergeAccumulator,
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
  timeZone: string | undefined,
  dayStartsAt: number,
): Comparable | null {
  const raw = row[dimension.field];
  if (raw === null || raw === undefined) return null;
  if (dimension.timeGrain) {
    return truncateDateToGrain(
      raw as string | number | Date,
      dimension.timeGrain,
      timeZone,
      dayStartsAt,
    );
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
    const key = query.dimensions.map((dimension) =>
      bucketValue(row, dimension, query.timeZone, query.dayStartsAt),
    );
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

/** The row ordering a query asks for, defaulting to the dimensions ascending. */
function rowComparator(query: CompiledQuery): (a: ReportRow, b: ReportRow) => number {
  const orderings =
    query.sort.length > 0
      ? query.sort
      : query.dimensions.map((dimension) => ({ alias: dimension.alias, direction: 'asc' as const }));
  return (a, b) => {
    for (const { alias, direction } of orderings) {
      const cmp = compareValues(sortableValue(a[alias]), sortableValue(b[alias]));
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  };
}

/** The label the folded remainder carries on the grouping dimension. */
export const OTHERS_BUCKET_LABEL = 'Outros';

/**
 * Fold every group past `topN` into ONE, labelled "Outros" (FUT-391).
 *
 * Without it a top-5 over twelve products silently discarded seven, so the
 * chart stopped adding up to the report's own total and nothing said why. The
 * remainder is merged at the ACCUMULATOR level, which keeps the bucket exact
 * for every aggregation — see {@link mergeAccumulator}.
 *
 * Single-dimension queries only. With a split, groups are per PAIR, so one
 * "Outros" ROW would have to answer "which series?" and any answer is a guess;
 * those keep the plain truncation.
 *
 * A split's tail is folded a level up instead, over SERIES rather than rows —
 * see `pivot.ts`, where "which series?" is the question being answered rather
 * than begged. That fold is the render layer's, so it applies to every adapter
 * alike; this one stays the in-memory source's own top-N.
 */
function foldOthers(ordered: Group[], query: CompiledQuery): Group[] | null {
  const topN = query.topN;
  if (topN === undefined || query.dimensions.length !== 1 || ordered.length <= topN) return null;

  const bucket: Group = {
    key: [OTHERS_BUCKET_LABEL],
    accumulators: query.measures.map(() => newAccumulator()),
  };
  for (const group of ordered.slice(topN)) {
    group.accumulators.forEach((accumulator, index) => {
      const target = bucket.accumulators[index];
      if (target && accumulator) mergeAccumulator(target, accumulator);
    });
  }
  return [...ordered.slice(0, topN), bucket];
}

/** Execute a compiled query over in-memory rows (exported for host adapters
 * that fetch raw rows and fold in process). */
export function executeCompiledQuery(rows: SourceRow[], query: CompiledQuery): ReportRow[] {
  const filtered = rows.filter((row) => query.filters.every((filter) => matchesFilter(row, filter)));
  const compare = rowComparator(query);
  // Groups are sorted by the row they PRODUCE — the author's ordering is
  // expressed over aliases — and folded afterwards, so "Outros" is the tail of
  // that ordering rather than of insertion order.
  const ordered = groupRows(filtered, query)
    .map((group) => ({ group, row: toReportRow(group, query) }))
    .sort((a, b) => compare(a.row, b.row))
    .map((entry) => entry.group);

  // The safety cap does NOT apply to a folded result: `limit` equals the
  // author's top-N, so slicing to it would chop off the very bucket the fold
  // just created and put the numbers back out of balance. A fold is already
  // bounded at topN + 1.
  const folded = foldOthers(ordered, query);
  const output = (folded ?? ordered).map((group) => toReportRow(group, query));
  return folded ? output : output.slice(0, query.limit);
}

/** Build a DataSource over plain per-entity row arrays. */
export function createMemoryDataSource(tables: Record<string, SourceRow[]>): ReportDataSource {
  return {
    execute: (query) => Promise.resolve(executeCompiledQuery(tables[query.entity] ?? [], query)),
  };
}
