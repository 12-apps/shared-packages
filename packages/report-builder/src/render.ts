import type { ChartNumberFormat, ChartSpec } from '@12-apps/ui/charts';

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
  | { kind: 'chart'; chartSpec: ChartSpec; rows: ReportRow[] }
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
      rows: withoutSuppressedCells(rows),
    };
  }
  if (presentation.kind === 'kpi') {
    return toKpiModel(query, presentation, catalog, rows);
  }
  const entity = requireEntityForRender(catalog, query.entity);
  const columns: ReportTableColumn[] = [
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
  return { kind: 'table', columns, rows };
}
