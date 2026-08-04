import {
  isPercentileAggregation,
  PERCENTILE_FRACTIONS,
  SUPPRESSED,
  type Aggregation,
  type CompiledMeasure,
  type ReportCellValue,
} from './types';

/**
 * Measure accumulation — one fold per group, shared by the in-memory reference
 * executor and any host adapter that folds rows in process, so aggregate
 * semantics can never drift between them.
 */

export type SourceRow = Record<string, unknown>;

export type Comparable = string | number | boolean;

export function normalize(value: unknown): Comparable | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

export function compareValues(a: Comparable | null, b: Comparable | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * CONTINUOUS percentile of an ascending sample: linear interpolation between
 * the two order statistics straddling the requested rank (R-7, the definition
 * `PERCENTILE.INC` and numpy's default use). Nearest-rank would round a p90 of
 * a 20-line sample to one of the observed values, which turns a service-level
 * target into a step function nobody can steer by.
 */
export function percentileOf(ascending: readonly number[], fraction: number): number | null {
  if (ascending.length === 0) return null;
  const rank = fraction * (ascending.length - 1);
  const lower = Math.floor(rank);
  const low = ascending[lower];
  if (low === undefined) return null;
  const high = ascending[Math.min(lower + 1, ascending.length - 1)] ?? low;
  return low + (rank - lower) * (high - low);
}

export interface MeasureAccumulator {
  sum: number;
  count: number;
  min: Comparable | null;
  max: Comparable | null;
  distinct: Set<Comparable>;
  /** Percentile inputs; collected only for percentile measures. */
  samples: number[];
  /** `ratio` only: the summed denominator. */
  denominatorSum: number;
  /**
   * Rows that put this measure's group into scope — the basis `minSample`
   * compares against. Non-null inputs for a plain aggregate; rows carrying a
   * denominator for a ratio, since the denominator IS the population.
   */
  eligible: number;
}

export function newAccumulator(): MeasureAccumulator {
  return {
    sum: 0,
    count: 0,
    min: null,
    max: null,
    distinct: new Set(),
    samples: [],
    denominatorSum: 0,
    eligible: 0,
  };
}

function trackExtremes(acc: MeasureAccumulator, value: Comparable): void {
  if (acc.min === null || compareValues(value, acc.min) < 0) acc.min = value;
  if (acc.max === null || compareValues(value, acc.max) > 0) acc.max = value;
}

function accumulateRatio(acc: MeasureAccumulator, measure: CompiledMeasure, row: SourceRow): void {
  const denominator = normalize(row[measure.denominatorField ?? '']);
  // No denominator, no line: the row is outside the ratio's population.
  if (typeof denominator !== 'number') return;
  const numerator = normalize(row[measure.field]);
  acc.eligible += 1;
  acc.count += 1;
  acc.denominatorSum += denominator;
  if (typeof numerator === 'number') acc.sum += numerator;
}

/** Fold one source row into a measure's accumulator. */
export function accumulate(
  acc: MeasureAccumulator,
  measure: CompiledMeasure,
  row: SourceRow,
): void {
  if (measure.aggregation === 'ratio') {
    accumulateRatio(acc, measure, row);
    return;
  }
  const value = normalize(row[measure.field]);
  if (value === null) return;
  acc.eligible += 1;
  acc.count += 1;
  acc.distinct.add(value);
  if (typeof value === 'number') {
    acc.sum += value;
    if (isPercentileAggregation(measure.aggregation)) acc.samples.push(value);
  }
  trackExtremes(acc, value);
}

/** sum / avg / ratio — the three that are NULL rather than 0 over nothing. */
function quotientAggregate(aggregation: Aggregation, acc: MeasureAccumulator): number | null {
  if (aggregation === 'sum') return acc.count === 0 ? null : acc.sum;
  if (aggregation === 'avg') return acc.count === 0 ? null : acc.sum / acc.count;
  // Ratio-of-sums: a zero denominator is undefined, not zero. Rendering shows
  // the same em-dash as a missing value rather than an inviting "0%".
  return acc.denominatorSum === 0 ? null : acc.sum / acc.denominatorSum;
}

const QUOTIENT_AGGREGATIONS: ReadonlySet<Aggregation> = new Set<Aggregation>([
  'sum',
  'avg',
  'ratio',
]);

function aggregateValue(aggregation: Aggregation, acc: MeasureAccumulator): ReportCellValue {
  if (isPercentileAggregation(aggregation)) {
    const ascending = [...acc.samples].sort((a, b) => a - b);
    return percentileOf(ascending, PERCENTILE_FRACTIONS[aggregation]);
  }
  if (QUOTIENT_AGGREGATIONS.has(aggregation)) return quotientAggregate(aggregation, acc);
  if (aggregation === 'count') return acc.count;
  if (aggregation === 'count_distinct') return acc.distinct.size;
  if (aggregation === 'min') return acc.min;
  return acc.max;
}

/**
 * Resolve a group's accumulator to its cell value, applying `minSample`
 * FIRST: below the threshold the aggregate is never written into the row, so
 * no field of the response carries it and no combination reconstructs it.
 */
export function finalize(measure: CompiledMeasure, acc: MeasureAccumulator): ReportCellValue {
  if (measure.minSample !== undefined && acc.eligible < measure.minSample) return SUPPRESSED;
  return aggregateValue(measure.aggregation, acc);
}
