import { OTHERS_BUCKET_LABEL } from './memory';
import type {
  Aggregation,
  CompiledQuery,
  EntityDef,
  FieldDef,
  ReportCellValue,
  ReportRow,
} from './types';

/**
 * Charting a SPLIT: the second dimension becomes the SERIES (FUT-755).
 *
 * A two-dimension result arrives from the executor in LONG form — one row per
 * (axis, split) pair, each carrying the measure:
 *
 *     { createdAt_day: '2026-07-01', method: 'PIX',  sum_totalCents: 1000 }
 *     { createdAt_day: '2026-07-01', method: 'CARD', sum_totalCents: 2000 }
 *     { createdAt_day: '2026-07-02', method: 'PIX',  sum_totalCents: 3000 }
 *
 * A chart reads the opposite shape: ONE row per x position, holding one cell
 * per series. That reshape is the whole of this module —
 *
 *     { createdAt_day: '2026-07-01', method__0: 1000, method__1: 2000 }
 *     { createdAt_day: '2026-07-02', method__0: 3000, method__1: null  }
 *
 * — and until it existed a chart could not honestly render a split at all:
 * `render.ts` built its series from the MEASURES, so a two-dimension spec
 * plotted one series and silently collapsed the other dimension. That is why
 * the compatibility matrix refused every chart with a split, and why relaxing
 * that rule without this file would have drawn the wrong picture instead of
 * refusing to draw one.
 *
 * Series keys are positional (`<splitAlias>__<n>`), never the split value
 * itself. Recharts resolves a `dataKey` with lodash `get`, so a value carrying
 * a `.` or a `[` ("Coca-Cola 2.5L") would be read as a PATH into the row and
 * plot nothing. The value's own text lives in the series LABEL, which is what
 * the legend and the table fallback render.
 */

/** A split value that is null or empty still needs a name in the legend. */
const EMPTY_SPLIT_LABEL = '(sem valor)';

/**
 * Aggregations whose per-group results may be ADDED, and therefore the only
 * ones whose tail can be folded into an exact "Outros" series.
 *
 * `sum` and `count` compose: the sum of a set of group sums IS the sum over
 * their union. Nothing else does — an average of averages is not an average, a
 * p90 of p90s is not a p90, and the union of two distinct-counts double-counts
 * whatever they share. `memory.ts` folds its own "Outros" row at the
 * ACCUMULATOR level for exactly this reason, and by the time rows reach the
 * render layer those accumulators are gone.
 */
const ADDITIVE_AGGREGATIONS: ReadonlySet<Aggregation> = new Set<Aggregation>(['sum', 'count']);

/** One drawn series: the row property holding its values, and its legend name. */
interface SplitSeries {
  key: string;
  label: string;
}

interface SplitPivot {
  series: SplitSeries[];
  /** Wide rows, one per axis bucket, in the order the query produced them. */
  rows: ReportRow[];
}

/** One split value's column of the crosstab, keyed by axis bucket. */
interface SplitBucket {
  label: string;
  /** Ranking weight only — never rendered, so a non-additive total is fine here. */
  total: number;
  cells: Map<string, ReportCellValue>;
}

interface AxisBucket {
  key: string;
  value: ReportCellValue;
}

interface SplitAliases {
  axis: string;
  split: string;
  measure: string;
}

function numeric(value: ReportCellValue | undefined): number {
  return typeof value === 'number' ? value : 0;
}

function seriesKey(splitAlias: string, index: number): string {
  return `${splitAlias}__${index}`;
}

/**
 * The legend name for one split value: the catalog's own label when the field
 * declares a closed set (so a chart says "Cartão", not `CARD`), else the stored
 * value.
 */
function splitLabel(field: FieldDef | undefined, raw: ReportCellValue): string {
  if (raw === null || raw === '') return EMPTY_SPLIT_LABEL;
  const text = String(raw);
  return field?.values?.find((option) => option.value === text)?.label ?? text;
}

/**
 * One pass over the long rows: the axis buckets in the order they appear (the
 * ordering the query already sorted them into) and one bucket per split value.
 */
function collect(
  rows: ReportRow[],
  aliases: SplitAliases,
  field: FieldDef | undefined,
): { axis: AxisBucket[]; buckets: SplitBucket[] } {
  const axis: AxisBucket[] = [];
  const seen = new Set<string>();
  const buckets = new Map<string, SplitBucket>();
  for (const row of rows) {
    const axisValue = row[aliases.axis] ?? null;
    const axisKey = String(axisValue);
    if (!seen.has(axisKey)) {
      seen.add(axisKey);
      axis.push({ key: axisKey, value: axisValue });
    }
    const splitValue = row[aliases.split] ?? null;
    const bucket = upsertBucket(buckets, String(splitValue), () =>
      splitLabel(field, splitValue),
    );
    const measured = row[aliases.measure] ?? null;
    bucket.total += numeric(measured);
    bucket.cells.set(axisKey, measured);
  }
  return { axis, buckets: [...buckets.values()] };
}

function upsertBucket(
  buckets: Map<string, SplitBucket>,
  key: string,
  label: () => string,
): SplitBucket {
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: SplitBucket = { label: label(), total: 0, cells: new Map() };
  buckets.set(key, created);
  return created;
}

/**
 * Biggest series first, ties broken by name so the same data always draws the
 * same chart — the palette is spent in this order, so an unstable sort would
 * recolour a report on every run.
 */
function rank(buckets: SplitBucket[]): SplitBucket[] {
  return [...buckets].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'),
  );
}

/** Merge everything past `keep` into one "Outros" column, cell by cell. */
function foldTail(ranked: SplitBucket[], keep: number): SplitBucket[] {
  const others: SplitBucket = { label: OTHERS_BUCKET_LABEL, total: 0, cells: new Map() };
  for (const bucket of ranked.slice(keep)) {
    others.total += bucket.total;
    bucket.cells.forEach((value, axisKey) => {
      // Only real figures contribute. Writing a 0 where the tail had no rows at
      // all would draw a point on the axis claiming a measured zero.
      if (typeof value !== 'number') return;
      others.cells.set(axisKey, numeric(others.cells.get(axisKey)) + value);
    });
  }
  return [...ranked.slice(0, keep), others];
}

/**
 * The series a split may actually draw.
 *
 * A split on an open-ended field (a product name, a customer) can produce
 * dozens of series: unreadable, and past the palette's length two of them
 * necessarily share a colour, which makes the legend ambiguous. So the tail
 * folds into "Outros" exactly the way a top-N row list already does — and,
 * like that one, the bucket is VISIBLE: it is a named series in the legend, so
 * the reader can see the chart still adds up to the report's total.
 *
 * When the measure cannot be folded exactly ({@link ADDITIVE_AGGREGATIONS}),
 * every series is kept instead. A busy chart is honest; a chart that quietly
 * drops series, or invents an "Outros" average nobody computed, is not.
 */
function capSeries(
  ranked: SplitBucket[],
  maxSeries: number,
  aggregation: Aggregation,
): SplitBucket[] {
  if (ranked.length <= maxSeries || !ADDITIVE_AGGREGATIONS.has(aggregation)) return ranked;
  return foldTail(ranked, maxSeries - 1);
}

/**
 * What a (axis, split) pair the query returned NO row for is worth.
 *
 * For an additive measure it is a measured zero, not a gap: "no card sales on
 * Tuesday" means R$ 0,00 of card revenue on Tuesday, and that is a fact the
 * chart should draw. For anything else the pair has no sample at all — an
 * average of nothing is not zero — so it stays a gap.
 *
 * A split makes this matter far more than a single dimension does, because
 * every axis bucket now has one cell per series and most of them are empty on
 * a sparse day. Left as gaps, a LINE chart of a split breaks into unconnected
 * dots (seen in the browser, not deducible from here).
 */
function absentCell(aggregation: Aggregation): ReportCellValue {
  return ADDITIVE_AGGREGATIONS.has(aggregation) ? 0 : null;
}

function toWideRow(
  axisAlias: string,
  axis: AxisBucket,
  series: SplitBucket[],
  splitAlias: string,
  absent: ReportCellValue,
): ReportRow {
  const row: ReportRow = { [axisAlias]: axis.value };
  series.forEach((bucket, index) => {
    // `has`, not `??`: a cell the query DID return but which is null — a
    // suppressed figure (FUT-454) — stays a gap even for an additive measure.
    // Filling it with a zero would state a total the server refused to compute.
    row[seriesKey(splitAlias, index)] = bucket.cells.has(axis.key)
      ? (bucket.cells.get(axis.key) ?? null)
      : absent;
  });
  return row;
}

/**
 * Reshape a two-dimension result into one series per split value.
 *
 * `maxSeries` is the caller's palette length: the render layer owns the colour
 * decision, and the cap exists because of it.
 */
export function pivotSplit(
  query: CompiledQuery,
  entity: EntityDef,
  rows: ReportRow[],
  maxSeries: number,
): SplitPivot {
  const axis = query.dimensions[0];
  const split = query.dimensions[1];
  const measure = query.measures[0];
  if (!axis || !split || !measure) {
    // compileReport already rejects this; kept as a defensive invariant.
    throw new Error('A split chart requires two dimensions and one measure.');
  }
  const aliases: SplitAliases = {
    axis: axis.alias,
    split: split.alias,
    measure: measure.alias,
  };
  const { axis: axisBuckets, buckets } = collect(rows, aliases, entity.fields[split.field]);
  const series = capSeries(rank(buckets), maxSeries, measure.aggregation);
  const absent = absentCell(measure.aggregation);
  return {
    series: series.map((bucket, index) => ({
      key: seriesKey(split.alias, index),
      label: bucket.label,
    })),
    rows: axisBuckets.map((bucket) =>
      toWideRow(axis.alias, bucket, series, split.alias, absent),
    ),
  };
}
