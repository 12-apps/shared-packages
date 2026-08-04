import type { ChartProps, ChartSeries } from './Chart.types';
import type { ChartSemanticColor, ChartSpec } from './ChartSpec.types';

/**
 * Renderer registry — the seam that lets new chart types be added without
 * touching consumers. A renderer maps a validated spec to the prop fragment
 * specific to its chart type; shared props (data, axes, legend, tooltip,
 * formatting) are derived once in `specToChartProps`.
 */

export interface ChartSpecRenderContext {
  /**
   * Resolve a semantic color token to a concrete theme color. `index` is the
   * series position, used to cycle the spec's color scheme when the series
   * has no explicit token.
   */
  resolveColor: (token: ChartSemanticColor | undefined, index: number) => string;
}

export type ChartSpecRenderer = (spec: ChartSpec, ctx: ChartSpecRenderContext) => Partial<ChartProps>;

const registry = new Map<string, ChartSpecRenderer>();

export function registerChartSpecRenderer(type: string, renderer: ChartSpecRenderer): void {
  registry.set(type, renderer);
}

export function getChartSpecRenderer(type: string): ChartSpecRenderer | undefined {
  return registry.get(type);
}

export function getRegisteredChartSpecTypes(): string[] {
  return [...registry.keys()];
}

function toChartSeries(spec: ChartSpec, ctx: ChartSpecRenderContext): ChartSeries[] {
  return spec.series.map((series, index) => ({
    dataKey: series.key,
    name: series.label ?? series.key,
    color: ctx.resolveColor(series.color, index),
  }));
}

function cartesianRenderer(chartType: 'line' | 'bar' | 'area'): ChartSpecRenderer {
  return (spec, ctx) => ({
    type: chartType,
    series: toChartSeries(spec, ctx),
    stacked: spec.stacked ?? false,
    curved: spec.curved ?? true,
  });
}

const pieRenderer: ChartSpecRenderer = (spec, ctx) => ({
  type: 'pie',
  series: toChartSeries(spec, ctx),
  // Slice colors cycle the resolved scheme; the pie renderer reads them from
  // the `colors` prop rather than per-series colors.
  colors: spec.series.length
    ? Array.from({ length: 12 }, (_, index) => ctx.resolveColor(undefined, index))
    : undefined,
});

const donutRenderer: ChartSpecRenderer = (spec, ctx) => ({
  ...pieRenderer(spec, ctx),
  // Proportional to the pie's outer radius (height / 3 in the Chart renderer).
  innerRadius: Math.round((spec.height ?? 400) / 6),
  centerLabel: spec.centerLabel,
});

registerChartSpecRenderer('line', cartesianRenderer('line'));
registerChartSpecRenderer('bar', cartesianRenderer('bar'));
registerChartSpecRenderer('area', cartesianRenderer('area'));
registerChartSpecRenderer('pie', pieRenderer);
registerChartSpecRenderer('donut', donutRenderer);
