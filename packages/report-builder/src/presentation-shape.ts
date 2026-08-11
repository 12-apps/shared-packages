import { invalidSpecError } from './errors';
import type { ReportSpec } from './spec';
import type { CompiledDimension } from './types';

/**
 * What each PRESENTATION demands of a spec's shape — the compiler half of the
 * rules `compatibility.ts` states as data for the authoring UI. A dedicated
 * test proves the two agree on every shape × presentation, so changing one
 * fails until the other follows.
 *
 * They live beside `compile.ts` rather than inside it because they are a
 * closed set of rules about the OUTPUT, not about lowering a spec into the IR:
 * everything else in that file maps a field, an aggregation or a filter.
 */

/**
 * The chart rules (FUT-755). A SECOND dimension is a split: the renderer
 * pivots it into one series per value (`pivot.ts`), so a line/area/bar chart
 * accepts one — it did not before, because nothing pivoted and a chart built
 * its series from the MEASURES alone, which would have plotted the wrong thing
 * rather than refused to plot.
 *
 * Two shapes stay out. A pie shows ONE series' composition, so a second
 * dimension has nowhere to go. And a split ALREADY spends the series axis, so
 * a second measure beside it is a three-way breakdown with two axes to draw it
 * on — and the two measures would have to share one number format besides.
 *
 * ONE RULE IS DELIBERATELY ABSENT: the ordered-axis rule (FUT-755) — a line or
 * an area needs an axis whose values have an order, so a line over payment
 * methods draws a slope between two things with nothing in between.
 * `compatibility.ts` enforces that for the PICKER; this file does NOT enforce
 * it for the compiler, and the asymmetry is the point.
 *
 * Saved reports already exist with exactly that shape. Throwing here would
 * replace those blocks with an error message for their owners — a worse
 * outcome than the chart they have, because the DATA is right and only the
 * join between points is a fiction. So `render.ts` degrades such a block to
 * BARS instead (same numbers, still legible, no error), and the picker refuses
 * the shape the next time the author opens the block. A correctness fix that
 * breaks stored data is not an improvement; one that quietly redraws it
 * correctly is.
 *
 * Keeping the compiler permissive also keeps the matrix ⟺ compiler test
 * honest: it still proves everything the matrix OFFERS compiles, and pins this
 * as the single rule on which the two deliberately differ.
 */
export function assertChartShape(spec: ReportSpec, dimensions: CompiledDimension[]): void {
  if (spec.presentation.kind !== 'chart') return;
  const { chartType } = spec.presentation;
  const isRound = chartType === 'pie' || chartType === 'donut';
  if (dimensions.length === 0) {
    throw invalidSpecError(
      `Chart presentation ("${chartType}") requires at least 1 dimension, got 0. Use presentation.kind "kpi" for a single ungrouped figure.`,
    );
  }
  if (dimensions.length > 1) {
    assertSplitChartShape(spec, dimensions, chartType, isRound);
  }
  if (isRound && spec.measures.length !== 1) {
    throw invalidSpecError(
      `"${chartType}" charts require exactly 1 measure, got ${spec.measures.length}.`,
    );
  }
}

function assertSplitChartShape(
  spec: ReportSpec,
  dimensions: CompiledDimension[],
  chartType: string,
  isRound: boolean,
): void {
  const split = dimensions[1]?.field ?? '';
  if (isRound) {
    throw invalidSpecError(
      `"${chartType}" charts show one series' composition, so they take exactly 1 dimension; "${split}" is a second. Drop it, or use presentation.kind "table".`,
    );
  }
  if (spec.measures.length !== 1) {
    throw invalidSpecError(
      `A split (second dimension "${split}") already draws one series per value, so it charts exactly 1 measure, got ${spec.measures.length}. Drop the extra measures or the split.`,
    );
  }
}

/**
 * The KPI rule (FUT-755): no dimensions, ONE OR MORE measures.
 *
 * The one-measure ceiling is gone. A KPI block renders one figure per measure
 * (`render.ts`'s `figures`), so "receita, pedidos e ticket médio" is ONE block
 * of three labelled numbers — where before, adding the second measure silently
 * fell back to a table and drew a header row above a single line.
 *
 * The no-dimension half stays, and it is the half with a reason: a KPI
 * summarises the WHOLE period, so with a grouping there is no single figure per
 * measure to show. The floor of one measure is the spec schema's own
 * (`measures: z.array(...).min(1)`), so nothing is left to assert on that side.
 */
export function assertKpiShape(spec: ReportSpec, dimensions: CompiledDimension[]): void {
  if (spec.presentation.kind !== 'kpi') return;
  if (dimensions.length !== 0) {
    throw invalidSpecError(
      `KPI presentation aggregates the whole period and takes no dimensions, got ${dimensions.length}. Remove the dimensions or use a chart/table.`,
    );
  }
}
