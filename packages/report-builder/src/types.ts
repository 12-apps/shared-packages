/**
 * Core contracts of the report builder.
 *
 * The architecture (Tabwoah-inspired): a declarative JSON {@link ReportSpec}
 * is validated against a host-registered {@link FieldCatalog}, compiled into
 * a neutral {@link CompiledQuery} IR, executed by a host-provided
 * {@link ReportDataSource} adapter (which owns tenant scoping), and rendered
 * into a table model or a `@12-apps/ui` ChartSpec. Specs are data, never code:
 * they can only name catalog fields, so a spec can never reach raw SQL or
 * another tenant's data.
 */

export type FieldType = 'string' | 'number' | 'money' | 'date' | 'boolean';

/**
 * Continuous percentiles (FUT-454). `p90` reads "the value 90% of the sample
 * is at or below", computed by LINEAR INTERPOLATION between the two
 * neighbouring order statistics (the R-7 / `PERCENTILE.INC` definition) — not
 * nearest-rank, which would snap a 20-line sample to one of its own rows.
 */
export type PercentileAggregation = 'p50' | 'p90' | 'p95';

export type Aggregation =
  | 'sum'
  | 'avg'
  | 'count'
  | 'min'
  | 'max'
  | 'count_distinct'
  | PercentileAggregation
  /** sum(numerator) / sum(denominator) — see {@link CompiledMeasure.denominatorField}. */
  | 'ratio';

export type TimeGrain = 'day' | 'week' | 'month';

export const PERCENTILE_AGGREGATIONS: readonly PercentileAggregation[] = ['p50', 'p90', 'p95'];

/** The sample fraction each percentile aggregation asks for. */
export const PERCENTILE_FRACTIONS: Readonly<Record<PercentileAggregation, number>> = {
  p50: 0.5,
  p90: 0.9,
  p95: 0.95,
};

const PERCENTILE_NAMES: ReadonlySet<string> = new Set(PERCENTILE_AGGREGATIONS);

export function isPercentileAggregation(
  aggregation: Aggregation,
): aggregation is PercentileAggregation {
  return PERCENTILE_NAMES.has(aggregation);
}

export const AGGREGATIONS: readonly Aggregation[] = [
  'sum',
  'avg',
  'count',
  'min',
  'max',
  'count_distinct',
  ...PERCENTILE_AGGREGATIONS,
  'ratio',
];

export const TIME_GRAINS: readonly TimeGrain[] = ['day', 'week', 'month'];

/**
 * How a value RENDERS, everywhere it is shown (dashboard, CSV export, API
 * metadata). Orthogonal to {@link FieldType}, which says what a value IS:
 * `duration` and `percent` are both stored as plain numbers (seconds and a
 * 0-1 ratio respectively) and only differ in presentation.
 */
export type ReportValueFormat = 'brl' | 'integer' | 'decimal' | 'text' | 'duration' | 'percent';

export const REPORT_VALUE_FORMATS: readonly ReportValueFormat[] = [
  'brl',
  'integer',
  'decimal',
  'text',
  'duration',
  'percent',
];

/** A KPI tile's format: the value formats that carry a figure, plus `compact`. */
export type ReportKpiFormat = Exclude<ReportValueFormat, 'text'> | 'compact';

/**
 * Server-side suppression marker (FUT-454). A measure carrying `minSample`
 * whose group has too few eligible rows resolves to THIS instead of its
 * value — the figure is never computed into the response, so it cannot be
 * recovered from anything the client receives. It is a plain string so every
 * existing row/wire contract keeps working; use {@link isSuppressed} to test.
 */
export const SUPPRESSED = '__suppressed__';

export type SuppressedValue = typeof SUPPRESSED;

/** Every value a result cell may hold, including the suppression marker. */
export type ReportCellValue = string | number | boolean | null;

export function isSuppressed(value: ReportCellValue | undefined): value is SuppressedValue {
  return value === SUPPRESSED;
}

/** One selectable value of a closed-set field: stored `value`, shown `label`. */
export interface FieldValueOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** Human label surfaced to builders and LLMs. */
  label: string;
  type: FieldType;
  /** Whether the field groups rows (dimension) or is aggregated (measure). */
  role: 'dimension' | 'measure';
  /** Allowed aggregations for a measure; defaults per {@link FieldType}. */
  aggregations?: readonly Aggregation[];
  /** How the field's values render; defaults per {@link FieldType}. */
  format?: ReportValueFormat;
  /** Optional description surfaced through field listings (LLM authoring). */
  description?: string;
  /**
   * The field's CLOSED set of values, labelled (FUT-391). A field that declares
   * these is filtered by PICKING — the builder offers "Pago", not a text box the
   * author has to type `PAID` into, which is the single largest source of
   * silently-empty blocks: a typo produces a valid spec that matches no rows.
   *
   * The label is display-only. Filters always carry the `value`, so renaming a
   * label never rewrites a stored spec.
   *
   * Absent means the field is open-ended (a name, a free-text note) and the
   * builder falls back to a text input, which is correct for those.
   */
  values?: readonly FieldValueOption[];
  /**
   * The filter operators this field accepts (FUT-391). Defaults per
   * {@link FieldType} — see `operatorsFor` — so a catalog only names these to
   * NARROW them. An enum offering `gte` invites "status a partir de Pago",
   * which compiles and means nothing.
   */
  ops?: readonly FilterOperator[];
  /**
   * Marks a DIMENSION as identifying an individual person (FUT-454). Grouping
   * by it forces EVERY measure of the spec to declare `minSample >= this`, so
   * a per-person figure below the floor can never be computed — the compiler
   * rejects the spec before a row is read.
   *
   * It lives on the catalog rather than on each spec because the floor is a
   * property of the DATA, not of one report: the run endpoint, a saved
   * dashboard block, a built-in preset and an LLM-authored spec over MCP all
   * pass through `compileReport`, so one declaration binds every path.
   *
   * It is a check on the SHAPE of the question, and shape alone is not a
   * barrier — see {@link identityMinSample}, which is.
   */
  minGroupSample?: number;
  /**
   * Marks a MEASURE as carrying an individual's own work (FUT-454): every spec
   * selecting it gets `minSample` raised to at least this value, so the figure
   * is withheld whenever ITS OWN eligible sample is too small — no matter how
   * the row came to be small.
   *
   * This is the barrier {@link minGroupSample} cannot be. That one derives the
   * floor from the fields a spec NAMES, and a spec need not name a cook to
   * isolate one: `stationName eq "Fritadeira"` + `attribution eq "Individual"`
   * over a two-hour window is one cook's p90 with no identity field anywhere
   * in the spec, and so is any narrow `readyAt`, `demandHourOfDay` or
   * `productName` predicate. The set of correlated predicates is not
   * enumerable, so the floor cannot live on the input side.
   *
   * The deliberate trade: this also suppresses genuinely small STATION-level
   * aggregates. That is the correct exchange — a p90 over three lines is not a
   * statistic anyone should steer by, and the locked decision is that per-cook
   * timing is withheld server-side everywhere.
   */
  identityMinSample?: number;
}

export interface EntityDef {
  label: string;
  description?: string;
  fields: Record<string, FieldDef>;
}

/**
 * The host's semantic model: which entities and fields a spec may reference.
 * Tenant scoping is the adapter's job — the catalog only bounds the shape.
 */
export interface FieldCatalog {
  entities: Record<string, EntityDef>;
}

export type FilterOperator = 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'between';

export type FilterValue = string | number | boolean;

export interface CompiledFilter {
  field: string;
  operator: FilterOperator;
  value?: FilterValue;
  values?: FilterValue[];
  from?: FilterValue;
  to?: FilterValue;
}

export interface CompiledDimension {
  field: string;
  timeGrain?: TimeGrain;
  /** Output column name for this dimension's bucket values. */
  alias: string;
}

export interface CompiledMeasure {
  field: string;
  aggregation: Aggregation;
  /** Output column name for this measure's aggregated values. */
  alias: string;
  /**
   * `ratio` only: the field summed as the DENOMINATOR. The measure resolves to
   * sum(field) / sum(denominatorField) — a ratio of sums, never the average of
   * per-row ratios, which would weight a one-item order like a fifty-item one.
   */
  denominatorField?: string;
  /**
   * Suppress this measure below N eligible rows (FUT-454). Enforced in the
   * executor, so the value never leaves the server; the cell holds
   * {@link SUPPRESSED} instead.
   *
   * The EFFECTIVE floor: the spec's own request raised to the catalog field's
   * {@link FieldDef.identityMinSample}, so an identity-sensitive measure
   * carries its floor even when the spec asked for none.
   */
  minSample?: number;
  /** Resolved render format (catalog field default, or the spec's override). */
  format: ReportValueFormat;
}

/**
 * Neutral query IR — everything an adapter needs to fetch grouped/aggregated
 * rows. Field names are catalog-validated before compilation, so adapters can
 * trust them (but still own tenant scoping and physical mapping).
 */
export interface CompiledQuery {
  entity: string;
  dimensions: CompiledDimension[];
  measures: CompiledMeasure[];
  filters: CompiledFilter[];
  sort: Array<{ alias: string; direction: 'asc' | 'desc' }>;
  /**
   * The hard row cap. This is a SAFETY bound — the host's `maxRows`, or the
   * spec's own limit when it asks for less — and rows beyond it are dropped.
   */
  limit: number;
  /**
   * The author's top-N, present only when the SPEC asked for one (FUT-391).
   *
   * Deliberately separate from {@link limit}, which the two used to share: a
   * query truncated at the 1000-row safety cap is not a top-N, and treating it
   * as one would staple an "Outros" bucket onto every large report. Only this
   * field means "show the leaders and fold the rest".
   */
  topN?: number;
  /**
   * The tenant's IANA zone, resolved at compile time (FUT-454). Date buckets
   * are computed on THIS clock, so a 02:00Z sale lands on the previous day in
   * `America/Sao_Paulo`. Adapters that group in SQL must convert with it.
   */
  timeZone: string;
  /**
   * The hour the tenant's trading day begins, 0-23, resolved at compile time
   * (FUT-755). 0 is the civil day. Anything earlier than this hour buckets to
   * the PREVIOUS day, so a bar closing at 02:00 keeps one night's takings on
   * one date. Adapters that group in SQL must apply it alongside `timeZone`.
   */
  dayStartsAt: number;
}

/** A result row keyed by dimension/measure aliases. */
export type ReportRow = Record<string, ReportCellValue>;

/**
 * Host adapter seam: executes a compiled query and returns aliased rows.
 * Implementations MUST scope every query to the calling tenant.
 */
export interface ReportDataSource {
  execute(query: CompiledQuery): Promise<ReportRow[]>;
}
