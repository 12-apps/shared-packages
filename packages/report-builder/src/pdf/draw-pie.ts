import type { Color } from 'pdf-lib';

import { formatKpiFigure } from '../format';
import type { ReportRenderModel } from '../render';
import { slicePalette, type ChartData } from './chart-data';
import type { TextStyle } from './canvas';
import type { PdfPaintContext } from './types';

type ChartModel = Extract<ReportRenderModel, { kind: 'chart' }>;

const PIE_HEIGHT = 150;
const SIDE_LEGEND_MIN_WIDTH = 300;
const STACKED_RADIUS = 52;
const MAX_SLICES = 9;
const STEP = Math.PI / 45;
const HOLE = 0.56;
const LEGEND_ROW = 13;
const LABEL: TextStyle = { size: 8, color: 'ink' };
const SHARE: TextStyle = { size: 8, bold: true, color: 'muted' };

interface Slice {
  label: string;
  value: number;
  color: Color;
}

/** Positive values of the first series, the tail folded into one "other" slice. */
function slicesOf(ctx: PdfPaintContext, model: ChartModel, data: ChartData): Slice[] {
  const palette = slicePalette(ctx, model);
  const values = data.categories
    .map((label, index) => ({ label, value: data.series[0]?.values[index] ?? 0 }))
    .filter((slice) => slice.value > 0);
  const head = values.slice(0, MAX_SLICES);
  const rest = values.slice(MAX_SLICES).reduce((sum, slice) => sum + slice.value, 0);
  const all = rest > 0 ? [...head, { label: ctx.copy.otherSlices, value: rest }] : head;
  return all.map((slice, index) => ({ ...slice, color: palette[index % palette.length] ?? ctx.canvas.tone('ink') }));
}

function arc(center: { x: number; top: number }, radius: number, from: number, to: number): { x: number; top: number }[] {
  const steps = Math.max(1, Math.ceil((to - from) / STEP));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps;
    return { x: center.x + radius * Math.cos(angle), top: center.top + radius * Math.sin(angle) };
  });
}

function drawSlices(ctx: PdfPaintContext, slices: Slice[], center: { x: number; top: number }, radius: number): void {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let angle = -Math.PI / 2;
  for (const slice of slices) {
    const end = angle + (slice.value / total) * Math.PI * 2;
    ctx.canvas.polygon([center, ...arc(center, radius, angle, end)], slice.color);
    angle = end;
  }
}

/** The figure in the hole, shrunk until it fits (never cut: a half-printed total misleads). */
function centreValueStyle(ctx: PdfPaintContext, value: string, width: number): TextStyle {
  let size = 11;
  while (size > 6 && ctx.canvas.width(value, { size, bold: true }) > width) size -= 0.5;
  return { size, bold: true, color: 'ink' };
}

function drawHole(ctx: PdfPaintContext, model: ChartModel, center: { x: number; top: number }, radius: number): void {
  const hole = radius * HOLE;
  ctx.canvas.polygon(arc(center, hole, 0, Math.PI * 2), 'white');
  const label = model.chartSpec.centerLabel;
  if (!label) return;
  const [caption, value] = typeof label === 'string' ? [label, null] : [label.label, String(label.value)];
  const style: TextStyle = { size: 8, color: 'muted' };
  ctx.canvas.text(ctx.canvas.fit(caption, style, hole * 1.7), center.x, center.top - (value ? 9 : 4), style, { align: 'center' });
  if (value) ctx.canvas.text(value, center.x, center.top + 1, centreValueStyle(ctx, value, hole * 1.7), { align: 'center' });
}

function drawSliceLegend(ctx: PdfPaintContext, slices: Slice[], box: { x: number; top: number; width: number }): void {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shareWidth = 38;
  slices.forEach((slice, index) => {
    const y = box.top + index * LEGEND_ROW;
    ctx.canvas.rect(box.x, y + 1, 7, 7, slice.color);
    ctx.canvas.text(ctx.canvas.fit(slice.label, LABEL, box.width - shareWidth - 14), box.x + 11, y, LABEL);
    ctx.canvas.text(formatKpiFigure(slice.value / total, 'percent'), box.x + box.width, y, SHARE, { align: 'right' });
  });
}

interface PieLayout {
  /** The legend sits beside the pie when there is room, else under it. */
  side: boolean;
  radius: number;
  height: number;
}

function layoutFor(width: number, count: number): PieLayout {
  if (width >= SIDE_LEGEND_MIN_WIDTH) return { side: true, radius: Math.min(PIE_HEIGHT / 2 - 6, width * 0.3), height: PIE_HEIGHT };
  const radius = Math.min(STACKED_RADIUS, width * 0.28);
  return { side: false, radius, height: radius * 2 + 10 + count * LEGEND_ROW };
}

/** The pie's height at `width`: fixed beside a legend, taller when the legend goes underneath. */
export function pieHeight(ctx: PdfPaintContext, model: ChartModel, data: ChartData, width: number): number {
  return layoutFor(width, slicesOf(ctx, model, data).length).height;
}

/** A pie or donut: slices as vector polygons, a legend with each share beside or under it. */
export function drawPie(
  ctx: PdfPaintContext,
  model: ChartModel,
  data: ChartData,
  box: { x: number; top: number; width: number },
): void {
  const slices = slicesOf(ctx, model, data);
  if (slices.length === 0) {
    ctx.canvas.text(ctx.copy.empty, box.x, box.top + 8, { size: 7.5, color: 'muted' });
    return;
  }
  const layout = layoutFor(box.width, slices.length);
  const { radius } = layout;
  const center = layout.side
    ? { x: box.x + radius + 4, top: box.top + PIE_HEIGHT / 2 }
    : { x: box.x + box.width / 2, top: box.top + radius + 4 };
  drawSlices(ctx, slices, center, radius);
  if (model.chartSpec.type === 'donut') drawHole(ctx, model, center, radius);
  if (!layout.side) {
    drawSliceLegend(ctx, slices, { x: box.x, top: box.top + radius * 2 + 12, width: box.width });
    return;
  }
  const legendLeft = box.x + radius * 2 + 22;
  const rows = Math.min(slices.length, Math.floor(PIE_HEIGHT / LEGEND_ROW));
  const top = box.top + (PIE_HEIGHT - rows * LEGEND_ROW) / 2;
  drawSliceLegend(ctx, slices.slice(0, rows), { x: legendLeft, top, width: box.x + box.width - legendLeft });
}
