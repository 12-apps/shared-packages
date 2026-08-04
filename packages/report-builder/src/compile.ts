import { invalidSpecError, unknownEntityError, unknownFieldError } from './errors';
import type { ReportDimension, ReportFilter, ReportMeasure, ReportSpec } from './spec';
import { DEFAULT_REPORT_TIME_ZONE, isValidTimeZone } from './time';
import { PERCENTILE_AGGREGATIONS } from './types';
import type {
  Aggregation,
  CompiledDimension,
  CompiledFilter,
  CompiledMeasure,
  CompiledQuery,
  EntityDef,
  FieldCatalog,
  FieldDef,
  ReportValueFormat,
} from './types';

export const DEFAULT_ROW_LIMIT = 1000;

export interface CompileOptions {
  /** Hard host-side row cap; clamps whatever the spec asks for. */
  maxRows?: number;
  /**
   * The calling tenant's IANA zone, used for date buckets unless the spec
   * names its own. Defaults to {@link DEFAULT_REPORT_TIME_ZONE}.
   */
  timeZone?: string;
}

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['number', 'money']);

function requireEntity(catalog: FieldCatalog, entity: string): EntityDef {
  const def = catalog.entities[entity];
  if (!def) throw unknownEntityError(entity, Object.keys(catalog.entities));
  return def;
}

function requireField(entity: string, def: EntityDef, field: string): FieldDef {
  const fieldDef = def.fields[field];
  if (!fieldDef) throw unknownFieldError(entity, field, Object.keys(def.fields));
  return fieldDef;
}

function allowedAggregations(field: FieldDef): readonly Aggregation[] {
  if (field.aggregations) return field.aggregations;
  if (field.role === 'dimension') return ['count', 'count_distinct'];
  switch (field.type) {
    case 'money':
    case 'number':
      return [
        'sum',
        'avg',
        'count',
        'min',
        'max',
        'count_distinct',
        ...PERCENTILE_AGGREGATIONS,
        'ratio',
      ];
    case 'date':
      return ['min', 'max', 'count'];
    default:
      return ['count', 'count_distinct'];
  }
}

function defaultAggregation(field: FieldDef): Aggregation {
  return NUMERIC_TYPES.has(field.type) ? 'sum' : 'count';
}

/**
 * Where a measure's render format comes from, most specific first: the spec's
 * per-measure override, then counting (always an integer), then the catalog
 * field's declared format, then the field type.
 */
function resolveFormat(
  field: FieldDef,
  aggregation: Aggregation,
  override: ReportValueFormat | undefined,
): ReportValueFormat {
  if (override) return override;
  if (aggregation === 'count' || aggregation === 'count_distinct') return 'integer';
  if (field.format) return field.format;
  if (field.type === 'money') return 'brl';
  if (field.type === 'number') return 'decimal';
  return 'text';
}

/** Validate the ratio's denominator (or its absence) and return the field name. */
function resolveDenominator(
  entity: string,
  def: EntityDef,
  measure: ReportMeasure,
  aggregation: Aggregation,
): string | undefined {
  if (aggregation !== 'ratio') {
    if (measure.denominator) {
      throw invalidSpecError(
        `"denominator" is only valid on "ratio" measures; "${measure.field}" uses "${aggregation}".`,
      );
    }
    return undefined;
  }
  if (!measure.denominator) {
    throw invalidSpecError(
      `Aggregation "ratio" requires "denominator" — the field summed as the divisor, e.g. { field: "${measure.field}", aggregation: "ratio", denominator: "<field>" }.`,
    );
  }
  const denominator = requireField(entity, def, measure.denominator);
  if (!NUMERIC_TYPES.has(denominator.type)) {
    throw invalidSpecError(
      `The "ratio" denominator must be a number or money field; "${measure.denominator}" is of type ${denominator.type}.`,
    );
  }
  return measure.denominator;
}

function compileDimension(entity: string, def: EntityDef, dim: ReportDimension): CompiledDimension {
  const field = requireField(entity, def, dim.field);
  if (field.role !== 'dimension') {
    throw invalidSpecError(
      `Field "${dim.field}" is a measure and cannot be used as a dimension. Group by a dimension field instead.`,
    );
  }
  if (dim.timeGrain && field.type !== 'date') {
    throw invalidSpecError(
      `"timeGrain" is only valid on date dimensions; "${dim.field}" is of type ${field.type}.`,
    );
  }
  const grain = field.type === 'date' ? (dim.timeGrain ?? 'day') : undefined;
  return {
    field: dim.field,
    timeGrain: grain,
    alias: grain ? `${dim.field}_${grain}` : dim.field,
  };
}

/**
 * Counting says HOW MANY observations there were, never what any of them was,
 * so it is exempt from the identity floor. Suppressing a count would also be
 * circular — the count IS the eligible sample the floor compares against — and
 * it would hide the one number that explains an empty row to its reader. Every
 * other aggregation (including `min`/`max`/`sum`, each of which resolves to a
 * single observation's value over a sample of one) stays floored.
 */
const COUNTING_AGGREGATIONS: ReadonlySet<Aggregation> = new Set<Aggregation>([
  'count',
  'count_distinct',
]);

/**
 * The floor this measure actually runs under: whatever the spec asked for,
 * raised to the catalog field's {@link FieldDef.identityMinSample}.
 *
 * Raising rather than replacing means the catalog can only ever make a spec
 * MORE private, never less — a preset that already declares a stricter floor
 * keeps it, and an explicit `minSample` on a count is still honoured.
 */
function effectiveMinSample(
  field: FieldDef,
  aggregation: Aggregation,
  requested: number | undefined,
): number | undefined {
  const identityFloor = field.identityMinSample ?? 0;
  if (identityFloor <= 0 || COUNTING_AGGREGATIONS.has(aggregation)) return requested;
  return Math.max(identityFloor, requested ?? 0);
}

function compileMeasure(entity: string, def: EntityDef, measure: ReportMeasure): CompiledMeasure {
  const field = requireField(entity, def, measure.field);
  const aggregation = (measure.aggregation ?? defaultAggregation(field)) as Aggregation;
  const allowed = allowedAggregations(field);
  if (!allowed.includes(aggregation)) {
    throw invalidSpecError(
      `Aggregation "${aggregation}" is not allowed on "${measure.field}" (${field.type} ${field.role}). Allowed: ${allowed.join(', ')}.`,
    );
  }
  const denominatorField = resolveDenominator(entity, def, measure, aggregation);
  const minSample = effectiveMinSample(field, aggregation, measure.minSample);
  return {
    field: measure.field,
    aggregation,
    alias: measure.alias ?? `${aggregation}_${measure.field}`,
    ...(denominatorField ? { denominatorField } : {}),
    ...(minSample !== undefined ? { minSample } : {}),
    format: resolveFormat(field, aggregation, measure.format),
  };
}

const RANGE_OPERATORS = new Set(['gte', 'lte', 'between']);

function compileFilter(entity: string, def: EntityDef, filter: ReportFilter): CompiledFilter {
  const field = requireField(entity, def, filter.field);
  if (RANGE_OPERATORS.has(filter.operator) && !['number', 'money', 'date'].includes(field.type)) {
    throw invalidSpecError(
      `Filter operator "${filter.operator}" needs a number, money or date field; "${filter.field}" is of type ${field.type}.`,
    );
  }
  return {
    field: filter.field,
    operator: filter.operator,
    value: filter.value,
    values: filter.values,
    from: filter.from,
    to: filter.to,
  };
}

function assertUniqueAliases(dimensions: CompiledDimension[], measures: CompiledMeasure[]): void {
  const seen = new Set<string>();
  for (const alias of [...dimensions.map((d) => d.alias), ...measures.map((m) => m.alias)]) {
    if (seen.has(alias)) {
      throw invalidSpecError(`Duplicate output column "${alias}". Give measures distinct aliases.`);
    }
    seen.add(alias);
  }
}

function assertChartShape(spec: ReportSpec, dimensions: CompiledDimension[]): void {
  if (spec.presentation.kind !== 'chart') return;
  const { chartType } = spec.presentation;
  if (dimensions.length !== 1) {
    throw invalidSpecError(
      `Chart presentation ("${chartType}") requires exactly 1 dimension, got ${dimensions.length}. Use presentation.kind "table" for multi-dimension breakdowns.`,
    );
  }
  if ((chartType === 'pie' || chartType === 'donut') && spec.measures.length !== 1) {
    throw invalidSpecError(`"${chartType}" charts require exactly 1 measure, got ${spec.measures.length}.`);
  }
}

function assertKpiShape(spec: ReportSpec, dimensions: CompiledDimension[]): void {
  if (spec.presentation.kind !== 'kpi') return;
  if (dimensions.length !== 0) {
    throw invalidSpecError(
      `KPI presentation aggregates the whole period and takes no dimensions, got ${dimensions.length}. Remove the dimensions or use a chart/table.`,
    );
  }
  if (spec.measures.length !== 1) {
    throw invalidSpecError(`KPI presentation requires exactly 1 measure, got ${spec.measures.length}.`);
  }
}

/** A measure's alias next to the floor its SPEC declared (before the catalog's). */
interface DeclaredFloor {
  alias: string;
  minSample: number | undefined;
}

/**
 * The spec-SHAPE check (FUT-454): a spec that names an identity field — by
 * grouping on it or by narrowing to it with a filter — is rejected outright
 * unless it declares `minSample` at or above that field's floor on every
 * measure.
 *
 * This is a cheap early rejection with an actionable message, NOT the barrier.
 * The barrier is {@link FieldDef.identityMinSample}, applied to the measures a
 * spec selects and enforced by `finalize` on each row's own eligible sample:
 * a spec need not name a cook to isolate one, and the set of predicates that
 * happen to correlate with a single person is not enumerable. Keeping this
 * check as well costs one pass and turns the most obvious per-cook spec into a
 * 400 that tells the author what to add, instead of a silently blank column.
 *
 * FILTERS count as well as dimensions: `filters: [{ field: "chefId",
 * operator: "eq", value: "…" }]` with no dimension at all produces ONE
 * ungrouped row holding exactly one cook's numbers.
 *
 * It reads the floor each measure DECLARED, not the effective one the catalog
 * raised it to — otherwise every identity-sensitive measure would satisfy the
 * check automatically and the rejection would never fire.
 */
function assertIdentitySuppression(
  def: EntityDef,
  dimensions: CompiledDimension[],
  measures: readonly DeclaredFloor[],
  filters: CompiledFilter[],
): void {
  let floor = 0;
  let identityField = '';
  let via = '';
  const referenced: Array<{ field: string; via: string }> = [
    ...dimensions.map((dimension) => ({ field: dimension.field, via: 'Grouping by' })),
    ...filters.map((filter) => ({ field: filter.field, via: 'Filtering on' })),
  ];
  for (const reference of referenced) {
    const declared = def.fields[reference.field]?.minGroupSample ?? 0;
    if (declared > floor) {
      floor = declared;
      identityField = reference.field;
      via = reference.via;
    }
  }
  if (floor === 0) return;
  const unfloored = measures.find(
    (measure) => measure.minSample === undefined || measure.minSample < floor,
  );
  if (unfloored) {
    throw invalidSpecError(
      `${via} "${identityField}" identifies an individual, so every measure must declare "minSample" of at least ${floor}; "${unfloored.alias}" declares ${unfloored.minSample ?? 'none'}. Add { "minSample": ${floor} } to each measure.`,
    );
  }
}

function compileSort(
  spec: ReportSpec,
  dimensions: CompiledDimension[],
  measures: CompiledMeasure[],
): CompiledQuery['sort'] {
  const aliases = new Set([...dimensions.map((d) => d.alias), ...measures.map((m) => m.alias)]);
  return spec.sort.map((entry) => {
    if (!aliases.has(entry.by)) {
      throw invalidSpecError(
        `Cannot sort by "${entry.by}" — it is not an output column. Available: ${[...aliases].join(', ')}.`,
      );
    }
    return { alias: entry.by, direction: entry.direction };
  });
}

/**
 * The zone date buckets are computed on, most specific first: the spec, then
 * the host's execution context, then São Paulo. Validated here so an unknown
 * zone is a 400 with a fixable message, never a silent fallback to UTC that
 * would shift every bucket by three hours.
 */
function resolveTimeZone(spec: ReportSpec, options: CompileOptions): string {
  const timeZone = spec.timeZone ?? options.timeZone ?? DEFAULT_REPORT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    throw invalidSpecError(
      `Unknown time zone "${timeZone}". Use an IANA name such as "${DEFAULT_REPORT_TIME_ZONE}".`,
    );
  }
  return timeZone;
}

/**
 * Catalog-aware validation + lowering of a structurally-valid spec into the
 * neutral {@link CompiledQuery} IR. Throws `ReportBuilderError` with
 * actionable messages on the first inconsistency.
 */
export function compileReport(
  spec: ReportSpec,
  catalog: FieldCatalog,
  options: CompileOptions = {},
): CompiledQuery {
  const entityDef = requireEntity(catalog, spec.entity);
  const dimensions = spec.dimensions.map((dim) => compileDimension(spec.entity, entityDef, dim));
  const measures = spec.measures.map((measure) => compileMeasure(spec.entity, entityDef, measure));
  assertUniqueAliases(dimensions, measures);
  assertChartShape(spec, dimensions);
  assertKpiShape(spec, dimensions);
  const filters = spec.filters.map((filter) => compileFilter(spec.entity, entityDef, filter));
  assertIdentitySuppression(
    entityDef,
    dimensions,
    measures.map((compiled, index) => ({
      alias: compiled.alias,
      minSample: spec.measures[index]?.minSample,
    })),
    filters,
  );
  const sort = compileSort(spec, dimensions, measures);
  const maxRows = options.maxRows ?? DEFAULT_ROW_LIMIT;
  return {
    entity: spec.entity,
    dimensions,
    measures,
    filters,
    sort,
    limit: Math.min(spec.limit ?? maxRows, maxRows),
    timeZone: resolveTimeZone(spec, options),
  };
}
