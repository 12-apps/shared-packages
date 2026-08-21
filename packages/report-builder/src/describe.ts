import type { SpecSentenceCopy } from './copy';
import type { Aggregation, FieldCatalog, FieldDef, TimeGrain } from './types';
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

/** Numeric types default to `sum`, everything else to `count` (mirrors the compiler). */
const NUMERIC_TYPES = new Set(['number', 'money']);

function entityLabel(catalog: FieldCatalog, entity: string, locale: string): string {
  const label = catalog.entities[entity]?.label;
  return (label ?? entity).toLocaleLowerCase(locale);
}

function fieldDef(catalog: FieldCatalog, entity: string, field: string): FieldDef | undefined {
  return catalog.entities[entity]?.fields[field];
}

function fieldLabel(
  catalog: FieldCatalog,
  entity: string,
  field: string,
  locale: string,
): string {
  const label = fieldDef(catalog, entity, field)?.label;
  return (label ?? field).toLocaleLowerCase(locale);
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
  copy: SpecSentenceCopy,
): string {
  const aggregation = resolveAggregation(measure, catalog, entity);
  const base = copy.measure(
    copy.aggregations[aggregation],
    fieldLabel(catalog, entity, measure.field, copy.locale),
  );
  if (aggregation === 'ratio' && measure.denominator) {
    return copy.ratio(base, fieldLabel(catalog, entity, measure.denominator, copy.locale));
  }
  return base;
}

/** `data (dia)` — the grain only appears when the spec buckets by one. */
function dimensionPhrase(
  dimension: ReportDimension,
  catalog: FieldCatalog,
  entity: string,
  copy: SpecSentenceCopy,
): string {
  const label = fieldLabel(catalog, entity, dimension.field, copy.locale);
  if (!dimension.timeGrain) return label;
  return copy.dimension(label, copy.grains[dimension.timeGrain as TimeGrain]);
}

/**
 * Renders a filter's operand. Values stay verbatim — the catalog carries no
 * enum value labels yet, so `PAID` cannot become "Pago" here without inventing
 * a mapping this function has no business owning.
 */
function filterOperand(filter: ReportFilter, copy: SpecSentenceCopy): string {
  if (filter.operator === 'between') {
    return copy.between(String(filter.from), String(filter.to));
  }
  if (filter.operator === 'in') return (filter.values ?? []).map(String).join(', ');
  return String(filter.value);
}

function filterPhrase(
  filter: ReportFilter,
  catalog: FieldCatalog,
  entity: string,
  copy: SpecSentenceCopy,
): string {
  return copy.filter(
    fieldLabel(catalog, entity, filter.field, copy.locale),
    copy.operators[filter.operator],
    filterOperand(filter, copy),
  );
}

/**
 * The spec sentence for a single report spec. No trailing period — callers
 * place it in headings, captions and subtitles where a full stop is wrong as
 * often as it is right.
 *
 * The clauses are assembled here; the ORDER they are spoken in is the host
 * pack's (`copy.sentence`), because that is the part that does not survive
 * translation.
 */
export function specSentence(
  spec: ReportSpec,
  catalog: FieldCatalog,
  copy: SpecSentenceCopy,
): string {
  const entity = spec.entity;
  const [groupBy, splitBy] = spec.dimensions;

  return copy.sentence({
    measures: copy.list(spec.measures.map((m) => measurePhrase(m, catalog, entity, copy))),
    entity: entityLabel(catalog, entity, copy.locale),
    ...(groupBy ? { groupBy: dimensionPhrase(groupBy, catalog, entity, copy) } : {}),
    // Only meaningful alongside a grouping: it splits that axis into series.
    ...(groupBy && splitBy
      ? { splitBy: dimensionPhrase(splitBy, catalog, entity, copy) }
      : {}),
    ...(spec.filters.length > 0
      ? { filters: copy.list(spec.filters.map((f) => filterPhrase(f, catalog, entity, copy))) }
      : {}),
    ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
  });
}

/**
 * What an untitled block is called. The same sentence, capitalised — so a
 * block that has never been named tracks its spec, and renaming a measure
 * renames the block.
 */
export function autoTitle(
  spec: ReportSpec,
  catalog: FieldCatalog,
  copy: SpecSentenceCopy,
): string {
  const sentence = specSentence(spec, catalog, copy);
  if (!sentence) return '';
  return sentence.charAt(0).toLocaleUpperCase(copy.locale) + sentence.slice(1);
}
