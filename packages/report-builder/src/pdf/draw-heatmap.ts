import type { ReportHeatmapAxisItem, ReportHeatmapCell, ReportHeatmapModel } from '../render-heatmap';
import { MARGIN_X, type TextStyle } from './canvas';
import { pdfValue } from './money';
import { drawHeader, headerFor } from './header';
import type { PdfPaintContext, ReportPdfBlock } from './types';

type Side = 'above-strong' | 'above' | 'below' | 'empty' | 'unmeasured';

const CELL_HEIGHT = 16;
const HEAD_HEIGHT = 16;
const LABEL_MAX = 90;
const LEGEND_LINE = 13;
/** Past this many columns on a side, the grid is turned so the long axis runs down the page. */
const TURN_AT = 8;
const EMPTY_MARK = '—';
const UNMEASURED_MARK = '(—)';

/** Which side of the target a cell sits on: the same rule the screen's `HeatMap` applies. */
function sideOf(cell: ReportHeatmapCell | undefined, scale: ReportHeatmapModel['scale']): Side {
  if (!cell) return 'empty';
  if (cell.value === null || !Number.isFinite(cell.value)) return cell.reason === 'unmeasured' ? 'unmeasured' : 'empty';
  if (cell.value > scale.target) return scale.strongAbove !== undefined && cell.value > scale.strongAbove ? 'above-strong' : 'above';
  return 'below';
}

interface Grid {
  rows: readonly ReportHeatmapAxisItem[];
  columns: readonly ReportHeatmapAxisItem[];
  at: (row: string, column: string) => ReportHeatmapCell | undefined;
}

function gridOf(model: ReportHeatmapModel): Grid {
  const byKey = new Map(model.cells.map((cell) => [`${cell.row}\u0000${cell.column}`, cell]));
  const turn = model.columnAxis.length > TURN_AT && model.columnAxis.length > model.rowAxis.length;
  return turn
    ? { rows: model.columnAxis, columns: model.rowAxis, at: (row, column) => byKey.get(`${column}\u0000${row}`) }
    : { rows: model.rowAxis, columns: model.columnAxis, at: (row, column) => byKey.get(`${row}\u0000${column}`) };
}

interface Geometry {
  x: number;
  labelWidth: number;
  cellWidth: number;
  style: TextStyle;
}

function drawColumnHead(ctx: PdfPaintContext, grid: Grid, geometry: Geometry, corner: string): void {
  const { canvas } = ctx;
  const head: TextStyle = { ...geometry.style, bold: true };
  canvas.rect(geometry.x, canvas.cursor, geometry.labelWidth + geometry.cellWidth * grid.columns.length, HEAD_HEIGHT, 'card');
  canvas.text(canvas.fit(corner, head, geometry.labelWidth - 6), geometry.x + 4, canvas.cursor + (HEAD_HEIGHT - head.size) / 2, head);
  grid.columns.forEach((column, index) => {
    const right = geometry.x + geometry.labelWidth + geometry.cellWidth * (index + 1) - 4;
    canvas.text(canvas.fit(column.label, head, geometry.cellWidth - 6), right, canvas.cursor + (HEAD_HEIGHT - head.size) / 2, head, {
      align: 'right',
    });
  });
  canvas.cursor += HEAD_HEIGHT;
}

/**
 * One cell. Above the target is bold AND outlined (twice as heavy, and hatched,
 * when strongly above), so the signal survives a black-and-white print; an hour
 * with no sale and an hour that sold with no cost priced read as different marks.
 */
function drawCell(
  ctx: PdfPaintContext,
  model: ReportHeatmapModel,
  cell: ReportHeatmapCell | undefined,
  box: { x: number; top: number; width: number },
  style: TextStyle,
): void {
  const { canvas } = ctx;
  const side = sideOf(cell, model.scale);
  const above = side === 'above' || side === 'above-strong';
  if (side === 'above-strong') canvas.hatch(box.x + 1, box.top + 1, box.width - 2, CELL_HEIGHT - 2, 'rule');
  if (above) canvas.outline(box.x + 1, box.top + 1, box.width - 2, CELL_HEIGHT - 2, 'ink', side === 'above-strong' ? 1.4 : 0.8);
  const text =
    side === 'empty'
      ? EMPTY_MARK
      : side === 'unmeasured'
        ? UNMEASURED_MARK
        : pdfValue(cell?.value, model.valueFormat, ctx.values, model.valueDecimals);
  const used: TextStyle = { ...style, bold: above, color: above || side === 'below' ? 'ink' : 'muted' };
  canvas.text(canvas.fit(text, used, box.width - 6), box.x + box.width - 4, box.top + (CELL_HEIGHT - style.size) / 2, used, {
    align: 'right',
  });
}

function drawLegend(ctx: PdfPaintContext, model: ReportHeatmapModel, x: number): void {
  const { canvas } = ctx;
  const style: TextStyle = { size: 7.5, color: 'muted' };
  const entries: { mark: 'above' | 'below' | 'empty' | 'unmeasured'; label: string }[] = [
    { mark: 'above', label: model.labels.above },
    { mark: 'below', label: model.labels.below },
    { mark: 'empty', label: model.labels.empty },
    ...(model.labels.unmeasured ? [{ mark: 'unmeasured' as const, label: model.labels.unmeasured }] : []),
  ];
  canvas.ensure(LEGEND_LINE + 6);
  canvas.cursor += 6;
  let left = x;
  for (const entry of entries) {
    const markWidth = 22;
    const need = markWidth + canvas.width(entry.label, style) + 14;
    if (left + need > x + 515 && left > x) {
      left = x;
      canvas.cursor += LEGEND_LINE;
    }
    if (entry.mark === 'above') {
      canvas.outline(left, canvas.cursor, 16, 10, 'ink', 0.8);
      canvas.text('12', left + 13, canvas.cursor + 1.5, { size: 6.5, bold: true, color: 'ink' }, { align: 'right' });
    } else if (entry.mark === 'below') {
      canvas.text('12', left + 13, canvas.cursor + 1.5, { size: 6.5, color: 'ink' }, { align: 'right' });
    } else {
      canvas.text(entry.mark === 'empty' ? EMPTY_MARK : UNMEASURED_MARK, left + 13, canvas.cursor + 1.5, { size: 6.5, color: 'muted' }, { align: 'right' });
    }
    canvas.text(entry.label, left + markWidth, canvas.cursor + 1, style);
    left += need;
  }
  canvas.cursor += LEGEND_LINE + 4;
}

/** A heat map as a grid of figures with the target's side marked and a legend under it. */
export function drawHeatmap(ctx: PdfPaintContext, block: ReportPdfBlock, model: ReportHeatmapModel, width: number): void {
  const { canvas } = ctx;
  const grid = gridOf(model);
  const header = headerFor(ctx, block, width);
  const style: TextStyle = { size: grid.columns.length > 12 ? 6.5 : 7.5, color: 'ink' };
  const labelWidth = Math.min(LABEL_MAX, Math.max(30, ...grid.rows.map((row) => canvas.width(row.label.slice(0, 40), style) + 10)));
  const geometry: Geometry = { x: MARGIN_X, labelWidth, cellWidth: (width - labelWidth) / Math.max(1, grid.columns.length), style };
  canvas.ensure(header.height + HEAD_HEIGHT + CELL_HEIGHT * 2);
  drawHeader(ctx, header, MARGIN_X, canvas.cursor);
  canvas.cursor += header.height;
  const corner = (model.tableColumns[0]?.label ?? '');
  drawColumnHead(ctx, grid, geometry, corner);
  for (const row of grid.rows) {
    canvas.tick();
    if (CELL_HEIGHT > canvas.remaining) {
      canvas.newPage();
      drawColumnHead(ctx, grid, geometry, corner);
    }
    canvas.text(canvas.fit(row.label, style, labelWidth - 6), MARGIN_X + 4, canvas.cursor + (CELL_HEIGHT - style.size) / 2, style);
    grid.columns.forEach((column, index) => {
      const box = { x: MARGIN_X + labelWidth + geometry.cellWidth * index, top: canvas.cursor, width: geometry.cellWidth };
      drawCell(ctx, model, grid.at(row.key, column.key), box, style);
    });
    canvas.line({ x: MARGIN_X, top: canvas.cursor + CELL_HEIGHT }, { x: MARGIN_X + width, top: canvas.cursor + CELL_HEIGHT }, 'grid');
    canvas.cursor += CELL_HEIGHT;
  }
  drawLegend(ctx, model, MARGIN_X);
  canvas.cursor += 6;
}
