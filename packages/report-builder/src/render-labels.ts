/**
 * What a rendered column, axis or series is CALLED.
 *
 * Split out of `render.ts` (FUT-755) because the labels are shared by every
 * branch of the renderer — the table's columns, a chart's axis title, a
 * series' name and a KPI figure's caption all come from these three — while
 * everything else in that file is about one presentation at a time. Keeping
 * them here is also what lets the KPI half live in its own module without
 * either importing the other back.
 *
 * These are DISPLAY labels, not the spec sentence: `describe.ts` writes prose
 * for a reader ("soma de receita em pedidos por data"), this writes the short
 * heading that has to fit in a column ("Receita (contagem)").
 */
import { isPercentileAggregation, type CompiledMeasure, type FieldDef } from './types';

function grainLabel(grain: string): string {
  switch (grain) {
    case 'week':
      return 'semana';
    case 'month':
      return 'mês';
    default:
      return 'dia';
  }
}

/** A dimension's heading, with its time grain in parentheses when it has one. */
export function dimensionLabel(
  field: FieldDef | undefined,
  alias: string,
  timeGrain?: string,
): string {
  const base = field?.label ?? alias;
  return timeGrain ? `${base} (${grainLabel(timeGrain)})` : base;
}

/**
 * A measure's heading, qualified by its aggregation where the bare field name
 * would be a lie — a count of orders is not "Pedidos", it is how many of them.
 * `sum`, `min` and `max` need no qualifier: the field's own name already reads
 * as the quantity they produce.
 */
export function measureLabel(field: FieldDef | undefined, measure: CompiledMeasure): string {
  const base = field?.label ?? measure.field;
  if (measure.aggregation === 'count' || measure.aggregation === 'count_distinct') {
    return `${base} (contagem)`;
  }
  if (measure.aggregation === 'avg') return `${base} (média)`;
  if (isPercentileAggregation(measure.aggregation)) return `${base} (${measure.aggregation})`;
  if (measure.aggregation === 'ratio') return `${base} (proporção)`;
  return base;
}
