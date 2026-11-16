import type { ReportKpiFigure } from '../render-kpi';
import { pdfFigure } from './money';
import type { ReportRenderModel } from '../render';
import type { TextStyle } from './canvas';
import type { PdfPaintContext } from './types';

type KpiModel = Extract<ReportRenderModel, { kind: 'kpi' }>;

const PAD = 9;
const LABEL: TextStyle = { size: 8, color: 'muted' };
const FLAG: TextStyle = { size: 7.5, bold: true, color: 'ink' };
const VALUE_SIZE = 19;
const VALUE_MIN = 9;
const CELL_MIN_WIDTH = 120;
const MAX_COLUMNS = 3;

function cellsPerRow(width: number, figures: number): number {
  return Math.max(1, Math.min(figures, MAX_COLUMNS, Math.floor((width - PAD * 2) / CELL_MIN_WIDTH)));
}

function figureHeight(figure: ReportKpiFigure): number {
  return LABEL.size * 1.3 + VALUE_SIZE * 1.25 + (figure.flag ? FLAG.size * 1.4 : 0) + 6;
}

function rowsOf(model: KpiModel, columns: number): ReportKpiFigure[][] {
  const rows: ReportKpiFigure[][] = [];
  for (let at = 0; at < model.figures.length; at += columns) rows.push(model.figures.slice(at, at + columns));
  return rows;
}

/** The tile's height at `width`: its figures in rows of up to three, plus padding. */
export function kpiHeight(model: KpiModel, width: number): number {
  const rows = rowsOf(model, cellsPerRow(width, model.figures.length));
  return PAD * 2 - 6 + rows.reduce((sum, row) => sum + Math.max(...row.map(figureHeight)), 0);
}

function valueStyle(ctx: PdfPaintContext, text: string, width: number): TextStyle {
  let size = VALUE_SIZE;
  while (size > VALUE_MIN && ctx.canvas.width(text, { size, bold: true }) > width) size -= 1;
  return { size, bold: true, color: 'ink' };
}

function drawFigure(ctx: PdfPaintContext, figure: ReportKpiFigure, x: number, top: number, width: number): void {
  const { canvas } = ctx;
  canvas.text(canvas.fit(figure.label, LABEL, width), x, top, LABEL);
  const value = pdfFigure(figure.suppressed ? null : figure.value, figure.format, figure.decimals);
  const style = valueStyle(ctx, value, width);
  canvas.text(value, x, top + LABEL.size * 1.3 + (VALUE_SIZE - style.size) * 0.5, style);
  if (figure.flag) {
    canvas.text(canvas.fit(figure.flag.label, FLAG, width), x, top + LABEL.size * 1.3 + VALUE_SIZE * 1.25, FLAG);
  }
}

/** The tile: a light card holding each measure's caption over its figure. */
export function drawKpi(ctx: PdfPaintContext, model: KpiModel, x: number, top: number, width: number, height: number): void {
  const { canvas } = ctx;
  canvas.rect(x, top, width, height, 'card');
  canvas.line({ x, top }, { x: x + width, top }, 'rule', 0.5);
  const columns = cellsPerRow(width, model.figures.length);
  const cellWidth = (width - PAD * 2) / columns;
  let y = top + PAD;
  for (const row of rowsOf(model, columns)) {
    row.forEach((figure, index) => drawFigure(ctx, figure, x + PAD + index * cellWidth, y, cellWidth - 8));
    y += Math.max(...row.map(figureHeight));
  }
}
