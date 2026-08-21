import type { ChartNumberFormat, ChartSemanticColor, ChartSpec } from '@12-apps/ui/charts';

import { requireEntityForRender } from './catalog';
import { isOrderedDimension } from './compatibility';
import { pivotSplit } from './pivot';
import { toKpiModel, type ReportKpiFigure } from './render-kpi';
import type { RenderLabelCopy } from './copy';
import { dimensionLabel, measureLabel } from './render-labels';
import type { ReportPresentation } from './spec';
import {
  isSuppressed,
  type CompiledQuery,
  type FieldCatalog,
  type ReportKpiFormat,
  type ReportRow,
  type ReportValueFormat,
} from './types';

/** Table column with a serializable format hint the host can render with. */
export interface ReportTableColumn {
  key: string;
  label: string;
  format: ReportValueFormat;
}

export type ReportRenderModel =
  | { kind: 'table'; columns: ReportTableColumn[]; rows: ReportRow[] }
  | {
      kind: 'chart';
      chartSpec: ChartSpec;
      /**
       * The columns describing THESE rows, carried so a chart can be read as a
       * table ("Ver como tabela", FUT-391) and exported without re-deriving
       * anything. Without a split they are exactly the columns the TABLE
       * presentation would produce; with one they describe the pivoted
       * crosstab the chart is drawn from (axis, then one column per series),
       * because that is what `rows` holds.
       *
       * It cannot be derived from `chartSpec`: the x-axis carries no title (it
       * rendered on top of the tick labels), so a derivation falls back to the
       * raw alias and the column reads `createdAt_day`. The label lives here,
       * built by the code the table branch already uses, so two views of one
       * query can never disagree about what a column is called.
       */
      tableColumns: ReportTableColumn[];
      rows: ReportRow[];
    }
  | {
      kind: 'kpi';
      /** Tile caption (spec label, else the measure's catalog label). */
      label: string;
      /** The aggregated figure; null when the period matched no rows. */
      value: number | null;
      /**
       * Whether `minSample` withheld the figure server-side (FUT-454). The
       * tile renders the same em-dash either way — this only tells the host
       * WHY, e.g. to caption "amostra insuficiente".
       */
      suppressed: boolean;
      format: ReportKpiFormat;
      /**
       * ONE FIGURE PER MEASURE (FUT-755) — the whole tile, in measure order.
       *
       * The four fields above are `figures[0]` restated, and they are kept
       * because they are the shape every host already reads: a KPI render has
       * carried a `label` and a `value` since FUT-309, and a package that
       * replaced them outright would break a consumer that never asked for a
       * second measure. So the single-measure payload is byte-for-byte what it
       * always was, and `figures` is the field a surface reads when it wants
       * to draw all of them.
       */
      figures: ReportKpiFigure[];
      rows: ReportRow[];
    };

/**
 * `@12-apps/ui` charts render a fixed set of number formats: `percent` there
 * already means a 0-1 fraction, so it maps straight through, while `duration`
 * has no axis formatter yet and falls back to the raw decimal (seconds).
 */
function toChartNumberFormat(format: ReportValueFormat): ChartNumberFormat {
  if (format === 'brl' || format === 'integer' || format === 'percent') return format;
  return 'decimal';
}

function chartNumberFormat(
  presentation: Extract<ReportPresentation, { kind: 'chart' }>,
  format: ReportValueFormat,
): ChartNumberFormat {
  if (presentation.numberFormat) return presentation.numberFormat;
  return toChartNumberFormat(format);
}

/**
 * A single-series chart is ONE accent and nothing else.
 *
 * `@12-apps/ui` cycles its whole semantic palette when a spec names no scheme,
 * so the first series happened to land on `primary` and every extra one pulled
 * in a competing saturated hue — a bar chart beside a pie put the theme's green
 * next to the theme's indigo, which `visual-pass.md` §Colour rules out in its
 * first line: "One accent. If a screen has two competing saturated colours, one
 * is wrong."
 */
const SINGLE_SERIES_SCHEME: ChartSemanticColor[] = ['primary'];

/**
 * The order the palette is spent in once a chart genuinely has categories to
 * tell apart — ordered so ADJACENT entries differ in LUMINANCE, not only hue.
 *
 * The default order is `primary, secondary, …`, and those two are the same
 * lightness at neighbouring hues: measured against the shipped theme, slices 1
 * and 2 of a pie were **1.06:1** apart. That is invisible in greyscale, to a
 * projector, and to anyone with a red-green deficiency — a chart whose slices
 * are distinguishable only to a reader with normal colour vision and a good
 * monitor. Interleaving the palette's light and dark halves takes the same six
 * tokens to ~1.4:1 between neighbours, which is what the tokens allow.
 *
 * It is DELIBERATELY the report builder's decision and not the chart library's:
 * `@12-apps/ui` stays a raw chart library, and every report-specific chart
 * choice (labels, formats, axis titles, smoothing, legends) already lives here.
 */
const MULTI_SERIES_SCHEME: ChartSemanticColor[] = [
  'primary',
  'warning',
  'success',
  'info',
  'danger',
  'secondary',
];

/**
 * The most series a SPLIT may draw — tied to the palette rather than picked,
 * because the palette is the constraint. Past this many, two series necessarily
 * share a colour and the legend stops telling them apart; `visual-pass.md`
 * §Colour asks for series separated by luminance, and a repeat is neither.
 * `pivotSplit` folds the remainder into "Outros" (visible in the legend) when
 * the measure allows it.
 */
const MAX_SPLIT_SERIES = MULTI_SERIES_SCHEME.length;

function toChartSpec(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'chart' }>,
  catalog: FieldCatalog,
  copy: RenderLabelCopy,
): ChartSpec {
  const entity = requireEntityForRender(catalog, query.entity);
  const dimension = query.dimensions[0];
  if (!dimension) {
    // compileReport already rejects this; kept as a defensive invariant.
    throw new Error('Chart presentation requires one dimension.');
  }
  const firstFormat = query.measures[0]?.format ?? 'decimal';
  // A pie or a donut is categorical even with ONE measure — its categories are
  // the slices, not the series — so it needs the separated palette that a
  // single-series bar or line does not.
  const isRound = presentation.chartType === 'pie' || presentation.chartType === 'donut';
  const categorical = isRound || query.measures.length > 1;
  return {
    type: presentation.chartType,
    // NO axis title (FUT-391). It rendered ON TOP of the tick labels, and the
    // block's spec sentence already says what the axis is — "…por data (dia)"
    // states it better than a word wedged under the ticks ever did.
    xAxis: { key: dimension.alias },
    series: query.measures.map((measure) => ({
      key: measure.alias,
      label: measureLabel(entity.fields[measure.field], measure, copy),
    })),
    stacked: presentation.stacked,
    // Straight segments, always (FUT-391). A smoothed line between two points
    // draws a curve through values nobody measured: the shape reads as data
    // and is not. Charts are read by store owners, not by people who know to
    // discount the interpolation.
    curved: false,
    // A legend that names ONE series repeats the block title and the spec
    // sentence directly above it, and costs a row of the chart's height to do
    // it (FUT-755). It earns its place only once there is something to tell
    // apart.
    legend: query.measures.length > 1,
    colorScheme: categorical ? MULTI_SERIES_SCHEME : SINGLE_SERIES_SCHEME,
    numberFormat: chartNumberFormat(presentation, firstFormat),
  };
}

/**
 * A chart's data points, with every SUPPRESSED cell turned into a gap
 * (FUT-454). A chart series is numeric: handing it the marker string would
 * plot garbage or NaN. `null` is what the renderer already draws for a missing
 * point, and "hidden" is supposed to be indistinguishable from "absent"
 * anyway — the same rule the cell formatter follows.
 */
function withoutSuppressedCells(rows: ReportRow[]): ReportRow[] {
  if (!rows.some((row) => Object.values(row).some(isSuppressed))) return rows;
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, isSuppressed(value) ? null : value]),
    ),
  );
}

/**
 * A split charted as multiple series (FUT-755).
 *
 * The rows are PIVOTED — see `pivot.ts` — so `rows`, `chartSpec.series` and
 * `tableColumns` all describe the same crosstab. They have to: `report-render`
 * hands one row array to both the chart and the "Ver como tabela" fallback, so
 * a chart drawn from wide rows beside columns describing long ones would put a
 * table of empty cells one keystroke from the chart.
 */
function toSplitChartModel(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'chart' }>,
  catalog: FieldCatalog,
  rows: ReportRow[],
  copy: RenderLabelCopy,
): ReportRenderModel {
  const entity = requireEntityForRender(catalog, query.entity);
  const axis = query.dimensions[0];
  const measure = query.measures[0];
  if (!axis || !measure) {
    // compileReport already rejects this; kept as a defensive invariant.
    throw new Error('A split chart requires one axis dimension and one measure.');
  }
  const pivot = pivotSplit(query, entity, withoutSuppressedCells(rows), MAX_SPLIT_SERIES);
  return {
    kind: 'chart',
    chartSpec: {
      type: presentation.chartType,
      xAxis: { key: axis.alias },
      series: pivot.series,
      // Grouped side by side when off, stacked when on — the panel's
      // "Empilhado" toggle, which reaches a split bar exactly as it reaches a
      // multi-measure one.
      stacked: presentation.stacked,
      curved: false,
      // Always: with a split the series ARE the categories, so the legend is
      // the only thing naming them. Colour must never carry meaning alone.
      legend: true,
      colorScheme: MULTI_SERIES_SCHEME,
      numberFormat: chartNumberFormat(presentation, measure.format),
    },
    tableColumns: [
      {
        key: axis.alias,
        label: dimensionLabel(entity.fields[axis.field], axis.alias, copy, axis.timeGrain),
        format: 'text' as const,
      },
      ...pivot.series.map((series) => ({
        key: series.key,
        label: series.label,
        format: measure.format,
      })),
    ],
    rows: pivot.rows,
  };
}

/**
 * Draw a stored line/area over an UNORDERED axis as bars instead (FUT-755).
 *
 * This exists for blocks SAVED BEFORE the rule. A line or an area asserts that
 * the space between two points is a value; over payment methods or product
 * names it is not, so the slope shows a relationship that does not exist. The
 * picker now refuses that shape going forward (`compatibility.ts`), and the
 * compiler deliberately still ACCEPTS it (`presentation-shape.ts`) so those
 * blocks keep rendering rather than turning into an error message for their
 * owners.
 *
 * Bars are the honest form of the identical data: nothing is recomputed, no
 * row changes, only the mark. The author is nudged the next time they open the
 * block, at which point saving rewrites the stored `chartType` for good.
 */
function withDrawableChartType(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'chart' }>,
  catalog: FieldCatalog,
): Extract<ReportPresentation, { kind: 'chart' }> {
  const { chartType } = presentation;
  if (chartType !== 'line' && chartType !== 'area') return presentation;
  const axis = query.dimensions[0];
  if (!axis) return presentation;
  const entity = requireEntityForRender(catalog, query.entity);
  if (isOrderedDimension(entity.fields[axis.field])) return presentation;
  return { ...presentation, chartType: 'bar' };
}

/**
 * Map a compiled query + result rows into a serializable render model: a table
 * model (columns with format hints), a `@12-apps/ui` ChartSpec, or a KPI's
 * figures. Every report-specific chart decision (labels, formats, spec
 * mapping) lives HERE — `@12-apps/ui` stays a raw chart library.
 */
export function renderReport(
  query: CompiledQuery,
  presentation: ReportPresentation,
  catalog: FieldCatalog,
  rows: ReportRow[],
  copy: RenderLabelCopy,
): ReportRenderModel {
  if (presentation.kind === 'chart') {
    const drawable = withDrawableChartType(query, presentation, catalog);
    if (query.dimensions.length > 1) {
      return toSplitChartModel(query, drawable, catalog, rows, copy);
    }
    return {
      kind: 'chart',
      chartSpec: toChartSpec(query, drawable, catalog, copy),
      tableColumns: tableColumnsFor(query, catalog, copy),
      rows: withoutSuppressedCells(rows),
    };
  }
  if (presentation.kind === 'kpi') {
    return toKpiModel(query, presentation, catalog, rows, copy);
  }
  return { kind: 'table', columns: tableColumnsFor(query, catalog, copy), rows };
}

/**
 * A query's columns: its dimensions, then its measures, in the order the query
 * asks for them. Shared by the table presentation and by a chart's table
 * fallback so the two can never name the same column differently.
 */
function tableColumnsFor(
  query: CompiledQuery,
  catalog: FieldCatalog,
  copy: RenderLabelCopy,
): ReportTableColumn[] {
  const entity = requireEntityForRender(catalog, query.entity);
  return [
    ...query.dimensions.map((dimension) => ({
      key: dimension.alias,
      label: dimensionLabel(entity.fields[dimension.field], dimension.alias, copy, dimension.timeGrain),
      format: 'text' as const,
    })),
    ...query.measures.map((measure) => ({
      key: measure.alias,
      label: measureLabel(entity.fields[measure.field], measure, copy),
      format: measure.format,
    })),
  ];
}
