import type { Aggregation, FieldCatalog, FieldDef, FilterOperator, TimeGrain } from './types';
import type { ReportDimension, ReportFilter, ReportMeasure, ReportSpec } from './spec';

/**
 * The spec sentence: a report block described in Portuguese, from the spec
 * alone.
 *
 *     soma de receita em pedidos por data (dia), onde status é Pago
 *
 * Three surfaces render it — the block subtitle, the config panel header and
 * the PDF caption — and they must not drift, so they all call THIS function.
 * It is also what {@link autoTitle} names an untitled block with.
 *
 * It is a DISPLAY function: it never throws and never validates. A spec naming
 * a field the catalog does not carry still produces a sentence (falling back
 * to the raw id), because a block whose spec has gone stale is exactly when a
 * reader most needs to see what it is asking for. Validation is
 * `compileReport`'s job and reports its own errors.
 */

const AGGREGATION_PHRASES: Record<Aggregation, string> = {
  sum: 'soma',
  avg: 'média',
  count: 'contagem',
  count_distinct: 'contagem distinta',
  min: 'mínimo',
  max: 'máximo',
  p50: 'mediana',
  p90: 'p90',
  p95: 'p95',
  ratio: 'proporção',
};

const GRAIN_PHRASES: Record<TimeGrain, string> = {
  day: 'dia',
  week: 'semana',
  month: 'mês',
};

/**
 * Read as `<campo> <operador> <valor>`, so each phrase completes a sentence
 * about the field: "status é Pago", "total é maior ou igual a 100".
 */
const OPERATOR_PHRASES: Record<FilterOperator, string> = {
  eq: 'é',
  neq: 'não é',
  in: 'é um de',
  gte: 'é maior ou igual a',
  lte: 'é menor ou igual a',
  between: 'está entre',
};

/** Numeric types default to `sum`, everything else to `count` (mirrors the compiler). */
const NUMERIC_TYPES = new Set(['number', 'money']);

function entityLabel(catalog: FieldCatalog, entity: string): string {
  const label = catalog.entities[entity]?.label;
  return (label ?? entity).toLocaleLowerCase('pt-BR');
}

function fieldDef(catalog: FieldCatalog, entity: string, field: string): FieldDef | undefined {
  return catalog.entities[entity]?.fields[field];
}

function fieldLabel(catalog: FieldCatalog, entity: string, field: string): string {
  const label = fieldDef(catalog, entity, field)?.label;
  return (label ?? field).toLocaleLowerCase('pt-BR');
}

function resolveAggregation(
  measure: ReportMeasure,
  catalog: FieldCatalog,
  entity: string,
): Aggregation {
  if (measure.aggregation) return measure.aggregation as Aggregation;
  const def = fieldDef(catalog, entity, measure.field);
  if (def && NUMERIC_TYPES.has(def.type)) return 'sum';
  return 'count';
}

/** `soma de receita`, and for a ratio the divisor it is measured against. */
function measurePhrase(
  measure: ReportMeasure,
  catalog: FieldCatalog,
  entity: string,
): string {
  const aggregation = resolveAggregation(measure, catalog, entity);
  const base = `${AGGREGATION_PHRASES[aggregation]} de ${fieldLabel(catalog, entity, measure.field)}`;
  if (aggregation === 'ratio' && measure.denominator) {
    return `${base} por ${fieldLabel(catalog, entity, measure.denominator)}`;
  }
  return base;
}

/** `data (dia)` — the grain only appears when the spec buckets by one. */
function dimensionPhrase(
  dimension: ReportDimension,
  catalog: FieldCatalog,
  entity: string,
): string {
  const label = fieldLabel(catalog, entity, dimension.field);
  if (!dimension.timeGrain) return label;
  return `${label} (${GRAIN_PHRASES[dimension.timeGrain as TimeGrain]})`;
}

/**
 * Renders a filter's operand. Values stay verbatim — the catalog carries no
 * enum value labels yet, so `PAID` cannot become "Pago" here without inventing
 * a mapping this function has no business owning.
 */
function filterOperand(filter: ReportFilter): string {
  if (filter.operator === 'between') return `${String(filter.from)} e ${String(filter.to)}`;
  if (filter.operator === 'in') return (filter.values ?? []).map(String).join(', ');
  return String(filter.value);
}

function filterPhrase(filter: ReportFilter, catalog: FieldCatalog, entity: string): string {
  const label = fieldLabel(catalog, entity, filter.field);
  return `${label} ${OPERATOR_PHRASES[filter.operator]} ${filterOperand(filter)}`;
}

/** Joins with a serial "e" so the tail reads as prose: `a, b e c`. */
function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/**
 * The spec sentence for a single report spec. No trailing period — callers
 * place it in headings, captions and subtitles where a full stop is wrong as
 * often as it is right.
 */
export function specSentence(spec: ReportSpec, catalog: FieldCatalog): string {
  const entity = spec.entity;
  const measures = joinPt(spec.measures.map((m) => measurePhrase(m, catalog, entity)));

  let sentence = `${measures} em ${entityLabel(catalog, entity)}`;

  const [groupBy, splitBy] = spec.dimensions;
  if (groupBy) {
    sentence += ` por ${dimensionPhrase(groupBy, catalog, entity)}`;
    // The second dimension is the SPLIT — it divides each bucket rather than
    // adding another level of grouping, which is what "dividido por" says.
    if (splitBy) sentence += `, dividido por ${dimensionPhrase(splitBy, catalog, entity)}`;
  }

  if (spec.filters.length > 0) {
    sentence += `, onde ${joinPt(spec.filters.map((f) => filterPhrase(f, catalog, entity)))}`;
  }

  // A limit without a sort is still a top N — the compiler applies the spec's
  // default ordering — so it is worth saying either way.
  if (spec.limit !== undefined) sentence += `, top ${spec.limit}`;

  return sentence;
}

/**
 * What an untitled block is called. The same sentence, capitalised — so a
 * block that has never been named tracks its spec, and renaming a measure
 * renames the block.
 */
export function autoTitle(spec: ReportSpec, catalog: FieldCatalog): string {
  const sentence = specSentence(spec, catalog);
  if (!sentence) return '';
  return sentence.charAt(0).toLocaleUpperCase('pt-BR') + sentence.slice(1);
}
