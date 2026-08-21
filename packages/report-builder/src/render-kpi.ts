/**
 * `Número`, with one figure per measure (FUT-755).
 *
 * A KPI block asks for no grouping, so its query returns EXACTLY ONE ROW — and
 * every measure in the block already has its figure in that row. The whole
 * change this module carries is that the renderer now looks past the first
 * one: "receita, pedidos e ticket médio" is one block of three labelled
 * numbers, where before adding the second measure silently fell back to a
 * table and drew a header above a single line.
 *
 * It is its own module rather than a section of `render.ts` because it is the
 * one branch of the renderer with a shape of its own — the chart and table
 * branches both produce columns over many rows, this produces figures over one.
 */
import { requireEntityForRender } from './catalog';
import type { RenderLabelCopy } from './copy';
import { measureLabel } from './render-labels';
import type { ReportPresentation } from './spec';
import {
  isSuppressed,
  type CompiledMeasure,
  type CompiledQuery,
  type FieldCatalog,
  type FieldDef,
  type ReportKpiFormat,
  type ReportRow,
} from './types';

/**
 * One labelled number in a KPI block.
 *
 * A block with no grouping returns exactly one row, so every measure in it
 * already HAS its figure in that row — this is only the question of whether the
 * renderer looks past the first one.
 */
export interface ReportKpiFigure {
  label: string;
  value: number | null;
  suppressed: boolean;
  format: ReportKpiFormat;
}

/**
 * One measure's figure, read out of the single row an ungrouped query returns.
 *
 * `overrides` are the presentation's own `label` / `numberFormat`, and they are
 * handed to the FIRST measure only. Both were authored when a tile had exactly
 * one figure — a caption cannot name three measures, and one number format
 * imposed on a money measure beside a count would misprint the count. Every
 * measure past the first therefore uses its own catalog label and its own
 * derived format, which is what an author adding a second measure expects.
 */
function toKpiFigure(
  measure: CompiledMeasure,
  overrides: { label?: string; numberFormat?: ReportKpiFormat },
  fields: Record<string, FieldDef>,
  row: ReportRow | undefined,
  copy: RenderLabelCopy,
): ReportKpiFigure {
  const raw = row?.[measure.alias];
  return {
    label: overrides.label ?? measureLabel(fields[measure.field], measure, copy),
    // A suppressed tile carries no figure at all — same shape as an empty period.
    value: typeof raw === 'number' ? raw : null,
    suppressed: isSuppressed(raw),
    format: overrides.numberFormat ?? (measure.format === 'text' ? 'decimal' : measure.format),
  };
}

/**
 * The KPI render model: `figures` for every measure, plus the FIRST figure
 * spread across the model's own `label` / `value` / `suppressed` / `format`.
 *
 * That duplication is the compatibility contract. Those four fields are what a
 * KPI render has carried since FUT-309 and what every host already reads, so a
 * single-measure tile stays byte-for-byte the payload it always was and a
 * consumer that never asked for a second measure keeps working untouched.
 */
export function toKpiModel(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'kpi' }>,
  catalog: FieldCatalog,
  rows: ReportRow[],
  copy: RenderLabelCopy,
): {
  kind: 'kpi';
  label: string;
  value: number | null;
  suppressed: boolean;
  format: ReportKpiFormat;
  figures: ReportKpiFigure[];
  rows: ReportRow[];
} {
  const entity = requireEntityForRender(catalog, query.entity);
  const row = rows[0];
  const figures = query.measures.map((measure, index) =>
    toKpiFigure(measure, index === 0 ? presentation : {}, entity.fields, row, copy),
  );
  const first = figures[0];
  if (!first) {
    // The spec schema already demands one measure; kept as a defensive invariant.
    throw new Error('KPI presentation requires at least one measure.');
  }
  return { kind: 'kpi', ...first, figures, rows };
}
