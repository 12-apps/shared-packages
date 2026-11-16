import type { Color } from 'pdf-lib';

import type { ReportRenderModel } from '../render';
import { cellText } from './cell';
import { DEFAULT_CHART_SCHEME } from './theme';
import type { PdfPaintContext } from './types';

type ChartModel = Extract<ReportRenderModel, { kind: 'chart' }>;

export interface ChartSeriesData {
  label: string;
  color: Color;
  /** Every second series is hatched, so two accents differ by more than hue on a grey print. */
  hatched: boolean;
  values: (number | null)[];
}

export interface ChartData {
  categories: string[];
  series: ChartSeriesData[];
  /** Points the data held before the ceiling cut it, when it did. */
  total: number;
}

/** The chart types it can draw; any other is an `unsupported_block`. */
export const CHART_TYPES: readonly string[] = ['bar', 'line', 'area', 'pie', 'donut'];

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Categories and series values out of the render model's rows, in row order. */
export function chartData(ctx: PdfPaintContext, model: ChartModel): ChartData {
  const { chartSpec: spec } = model;
  const axisColumn = model.tableColumns.find((column) => column.key === spec.xAxis.key);
  const rows = model.rows.slice(0, ctx.maxChartPoints);
  const scheme = spec.colorScheme && spec.colorScheme.length > 0 ? spec.colorScheme : DEFAULT_CHART_SCHEME;
  return {
    total: model.rows.length,
    categories: rows.map((row) => {
      const raw = row[spec.xAxis.key];
      if (axisColumn) return cellText(raw, axisColumn, ctx);
      return raw === null || raw === undefined ? '' : String(raw);
    }),
    series: spec.series.map((series, index) => ({
      label: series.label ?? series.key,
      hatched: index % 2 === 1,
      color: ctx.canvas.accent(series.color ?? scheme[index % scheme.length] ?? 'primary'),
      values: rows.map((row) => numberOrNull(row[series.key])),
    })),
  };
}

export function hasPoints(data: ChartData): boolean {
  return data.categories.length > 0 && data.series.some((series) => series.values.some((value) => value !== null));
}

/** The colours a pie's slices cycle through: the spec's scheme, else the default one. */
export function slicePalette(ctx: PdfPaintContext, model: ChartModel): Color[] {
  const { colorScheme } = model.chartSpec;
  return (colorScheme && colorScheme.length > 0 ? colorScheme : DEFAULT_CHART_SCHEME).map((token) => ctx.canvas.accent(token));
}
