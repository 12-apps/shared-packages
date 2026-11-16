import type { ReportRenderModel } from '../render';
import { chartData, hasPoints, type ChartData } from './chart-data';
import { niceScale, tickText, type Scale } from './chart-scale';
import type { TextStyle } from './canvas';
import { drawLegend, LEGEND_LINE, legendLines, type LegendEntry } from './draw-legend';
import { drawPie, pieHeight } from './draw-pie';
import type { PdfPaintContext } from './types';

type ChartModel = Extract<ReportRenderModel, { kind: 'chart' }>;

const PLOT_HEIGHT = 120;
const LABEL_BAND = 16;
const AXIS_TITLE_BAND = 10;
const EMPTY_HEIGHT = 36;
const NOTE_HEIGHT = 12;
const TICK: TextStyle = { size: 7, color: 'muted' };
const TITLE: TextStyle = { size: 7.5, color: 'muted' };
const MARKER = 2.4;

function isPie(model: ChartModel): boolean {
  return model.chartSpec.type === 'pie' || model.chartSpec.type === 'donut';
}

function legendEntries(ctx: PdfPaintContext, data: ChartData, width: number): LegendEntry[] {
  const style: TextStyle = { size: 8 };
  return data.series.map((series) => ({
    label: ctx.canvas.fit(series.label, style, width - 24),
    color: series.color,
    hatched: series.hatched,
  }));
}

function legendHeight(ctx: PdfPaintContext, data: ChartData, width: number): number {
  if (data.series.length < 2) return 0;
  return legendLines(ctx, legendEntries(ctx, data, width), width).length * LEGEND_LINE + 4;
}

/** The chart's height at `width`: legend, plot, label band and the truncation note. */
export function chartHeight(ctx: PdfPaintContext, model: ChartModel, width: number): number {
  const data = chartData(ctx, model);
  if (!hasPoints(data)) return EMPTY_HEIGHT;
  const note = data.total > data.categories.length ? NOTE_HEIGHT : 0;
  if (isPie(model)) return pieHeight(ctx, model, data, width) + note;
  const title = model.chartSpec.yAxis?.label ? AXIS_TITLE_BAND : 0;
  return legendHeight(ctx, data, width) + title + PLOT_HEIGHT + LABEL_BAND + note;
}

/** The values each series is drawn at: running totals when it is stacked. */
function stackedTops(data: ChartData, stacked: boolean): (number | null)[][] {
  if (!stacked) return data.series.map((series) => series.values);
  const running = data.categories.map(() => 0);
  return data.series.map((series) =>
    series.values.map((value, index) => {
      if (value === null) return null;
      running[index] = (running[index] ?? 0) + value;
      return running[index] ?? 0;
    }),
  );
}

function scaleOf(tops: (number | null)[][]): Scale {
  const all = tops.flat().filter((value): value is number => value !== null);
  return niceScale(Math.min(0, ...all), Math.max(0, ...all));
}

interface Plot {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: Scale;
}

function yOf(plot: Plot, value: number): number {
  const { scale } = plot;
  return plot.top + plot.height * (1 - (value - scale.min) / (scale.max - scale.min));
}

function drawGrid(ctx: PdfPaintContext, plot: Plot, format: ChartModel['chartSpec']['numberFormat']): void {
  for (const tick of plot.scale.ticks) {
    const y = yOf(plot, tick);
    ctx.canvas.line({ x: plot.left, top: y }, { x: plot.left + plot.width, top: y }, tick === 0 ? 'rule' : 'grid', 0.5);
    ctx.canvas.text(tickText(tick, format), plot.left - 4, y - TICK.size / 2, TICK, { align: 'right' });
  }
}

function drawCategoryLabels(ctx: PdfPaintContext, plot: Plot, data: ChartData, axisTitle?: string): void {
  const slot = plot.width / data.categories.length;
  const widest = Math.max(...data.categories.map((label) => ctx.canvas.width(label, TICK)));
  const step = Math.max(1, Math.ceil((Math.min(widest, 90) + 6) / slot));
  const top = plot.top + plot.height + 4;
  data.categories.forEach((label, index) => {
    if (index % step !== 0) return;
    const text = ctx.canvas.fit(label, TICK, Math.max(slot * step - 4, 12));
    ctx.canvas.text(text, plot.left + slot * (index + 0.5), top, TICK, { align: 'center' });
  });
  if (axisTitle) ctx.canvas.text(axisTitle, plot.left + plot.width / 2, top + 10, TITLE, { align: 'center' });
}

function drawBars(ctx: PdfPaintContext, plot: Plot, data: ChartData, stacked: boolean): void {
  const slot = plot.width / data.categories.length;
  const group = slot * 0.72;
  const each = stacked ? group : group / data.series.length;
  const tops = stackedTops(data, stacked);
  data.series.forEach((series, seriesAt) => {
    series.values.forEach((value, index) => {
      if (value === null || value === 0) return;
      const end = tops[seriesAt]?.[index] ?? value;
      const from = stacked ? end - value : 0;
      const x = plot.left + slot * index + (slot - group) / 2 + (stacked ? 0 : each * seriesAt);
      const [a, b] = [yOf(plot, from), yOf(plot, end)];
      const box = { x, top: Math.min(a, b), width: Math.max(each - 1, 1), height: Math.max(Math.abs(a - b), 0.6) };
      ctx.canvas.rect(box.x, box.top, box.width, box.height, series.color);
      if (series.hatched) ctx.canvas.hatch(box.x, box.top, box.width, box.height, 'white');
    });
  });
}

function drawLines(ctx: PdfPaintContext, plot: Plot, data: ChartData, mode: { area: boolean; stacked: boolean }): void {
  const slot = plot.width / data.categories.length;
  const tops = stackedTops(data, mode.stacked && mode.area);
  data.series.forEach((series, seriesAt) => {
    const points = (tops[seriesAt] ?? []).map((value, index) =>
      value === null ? null : { x: plot.left + slot * (index + 0.5), top: yOf(plot, value) },
    );
    const drawn = points.filter((point): point is { x: number; top: number } => point !== null);
    if (mode.area && drawn.length > 1) {
      const floor = yOf(plot, 0);
      const first = drawn[0];
      const last = drawn[drawn.length - 1];
      if (first && last) {
        ctx.canvas.polygon([{ x: first.x, top: floor }, ...drawn, { x: last.x, top: floor }], series.color, 0.16);
      }
    }
    points.forEach((point, index) => {
      const next = points[index + 1];
      if (point && next) ctx.canvas.line(point, next, series.color, 1.5, series.hatched ? [4, 2] : undefined);
    });
    if (data.categories.length <= 30) {
      for (const point of drawn) ctx.canvas.rect(point.x - MARKER / 2, point.top - MARKER / 2, MARKER, MARKER, series.color);
    }
  });
}

function drawCartesian(ctx: PdfPaintContext, model: ChartModel, data: ChartData, box: { x: number; top: number; width: number }): void {
  const { chartSpec: spec } = model;
  let top = box.top;
  if (data.series.length > 1) {
    const lines = legendLines(ctx, legendEntries(ctx, data, box.width), box.width);
    drawLegend(ctx, lines, box.x, top);
    top += lines.length * LEGEND_LINE + 4;
  }
  if (spec.yAxis?.label) {
    ctx.canvas.text(spec.yAxis.label, box.x, top, TITLE);
    top += AXIS_TITLE_BAND;
  }
  const stacked = spec.stacked === true;
  const scale = scaleOf(stackedTops(data, stacked));
  const labelWidth = Math.max(...scale.ticks.map((tick) => ctx.canvas.width(tickText(tick, spec.numberFormat), TICK)));
  const left = box.x + labelWidth + 8;
  const plot: Plot = { left, top: top + 4, width: box.x + box.width - left - 4, height: PLOT_HEIGHT - 4, scale };
  drawGrid(ctx, plot, spec.numberFormat);
  if (spec.type === 'bar') drawBars(ctx, plot, data, stacked);
  else drawLines(ctx, plot, data, { area: spec.type === 'area', stacked });
  drawCategoryLabels(ctx, plot, data, spec.xAxis.label);
}

/** The chart in its box: bars, lines, areas, or a pie with its own legend. */
export function drawChart(ctx: PdfPaintContext, model: ChartModel, box: { x: number; top: number; width: number }): void {
  const data = chartData(ctx, model);
  if (!hasPoints(data)) {
    ctx.canvas.text(ctx.copy.empty, box.x, box.top + 8, TITLE);
    return;
  }
  if (isPie(model)) drawPie(ctx, model, data, box);
  else drawCartesian(ctx, model, data, box);
  if (data.total > data.categories.length) {
    const used = chartHeight(ctx, model, box.width) - NOTE_HEIGHT;
    ctx.canvas.text(ctx.copy.chartTruncated(data.categories.length, data.total), box.x, box.top + used + 2, TITLE);
  }
}
