import type { ChartNumberFormat, ChartSemanticColor, ChartSpec } from '@12-apps/ui/charts';

import { requireEntityForRender } from './catalog';
import type { ReportPresentation } from './spec';
import {
  isPercentileAggregation,
  isSuppressed,
  type CompiledMeasure,
  type CompiledQuery,
  type FieldCatalog,
  type FieldDef,
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
       * The same columns the TABLE presentation would produce, carried so a
       * chart can be read as a table ("Ver como tabela", FUT-391) and exported
       * without re-deriving anything.
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
      rows: ReportRow[];
    };

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

function dimensionLabel(field: FieldDef | undefined, alias: string, timeGrain?: string): string {
  const base = field?.label ?? alias;
  return timeGrain ? `${base} (${grainLabel(timeGrain)})` : base;
}

function measureLabel(field: FieldDef | undefined, measure: CompiledMeasure): string {
  const base = field?.label ?? measure.field;
  if (measure.aggregation === 'count' || measure.aggregation === 'count_distinct') {
    return `${base} (contagem)`;
  }
  if (measure.aggregation === 'avg') return `${base} (média)`;
  if (isPercentileAggregation(measure.aggregation)) return `${base} (${measure.aggregation})`;
  if (measure.aggregation === 'ratio') return `${base} (proporção)`;
  return base;
}

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

function toChartSpec(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'chart' }>,
  catalog: FieldCatalog,
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
      label: measureLabel(entity.fields[measure.field], measure),
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
 * Map a compiled query + result rows into a serializable render model:
 * either a table model (columns with format hints) or a `@12-apps/ui`
 * ChartSpec. Every report-specific chart decision (labels, formats, spec
 * mapping) lives HERE — `@12-apps/ui` stays a raw chart library.
 */
function toKpiModel(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'kpi' }>,
  catalog: FieldCatalog,
  rows: ReportRow[],
): ReportRenderModel {
  const entity = requireEntityForRender(catalog, query.entity);
  const measure = query.measures[0];
  if (!measure) {
    // compileReport already rejects this; kept as a defensive invariant.
    throw new Error('KPI presentation requires one measure.');
  }
  const field = entity.fields[measure.field];
  const raw = rows[0]?.[measure.alias];
  return {
    kind: 'kpi',
    label: presentation.label ?? measureLabel(field, measure),
    // A suppressed tile carries no figure at all — same shape as an empty period.
    value: typeof raw === 'number' ? raw : null,
    suppressed: isSuppressed(raw),
    format: presentation.numberFormat ?? (measure.format === 'text' ? 'decimal' : measure.format),
    rows,
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

export function renderReport(
  query: CompiledQuery,
  presentation: ReportPresentation,
  catalog: FieldCatalog,
  rows: ReportRow[],
): ReportRenderModel {
  if (presentation.kind === 'chart') {
    return {
      kind: 'chart',
      chartSpec: toChartSpec(query, presentation, catalog),
      tableColumns: tableColumnsFor(query, catalog),
      rows: withoutSuppressedCells(rows),
    };
  }
  if (presentation.kind === 'kpi') {
    return toKpiModel(query, presentation, catalog, rows);
  }
  return { kind: 'table', columns: tableColumnsFor(query, catalog), rows };
}

/**
 * A query's columns: its dimensions, then its measures, in the order the query
 * asks for them. Shared by the table presentation and by a chart's table
 * fallback so the two can never name the same column differently.
 */
function tableColumnsFor(query: CompiledQuery, catalog: FieldCatalog): ReportTableColumn[] {
  const entity = requireEntityForRender(catalog, query.entity);
  return [
    ...query.dimensions.map((dimension) => ({
      key: dimension.alias,
      label: dimensionLabel(entity.fields[dimension.field], dimension.alias, dimension.timeGrain),
      format: 'text' as const,
    })),
    ...query.measures.map((measure) => ({
      key: measure.alias,
      label: measureLabel(entity.fields[measure.field], measure),
      format: measure.format,
    })),
  ];
}
