import type { ReportRow } from '../types';
import { cellText, isNumericFormat, type CellColumn } from './cell';
import { MARGIN_X, type TextStyle } from './canvas';
import { drawHeader, headerFor } from './header';
import type { PdfPaintContext, ReportPdfBlock } from './types';

export interface PdfTableColumn extends CellColumn {
  key: string;
  label: string;
  /** Forces the side a cell sits on; absent, numbers sit right and words left. */
  align?: 'left' | 'right';
}

export interface PdfTableData {
  columns: readonly PdfTableColumn[];
  rows: readonly ReportRow[];
  /** Rows the presentation's flag marks, with the words that say why. */
  flag?: { column: string; label: string; rows: ReadonlySet<number> };
}

const ROW_HEIGHT = 15;
const HEAD_HEIGHT = 18;
const PAD = 4;
const SAMPLE_ROWS = 60;
const MIN_COLUMN = 34;
const MAX_COLUMN = 220;
const NOTE: TextStyle = { size: 8, color: 'muted' };
/** Text this long already fills the widest column. */
const WIDTH_PROBE_CHARS = 160;

function bodyStyle(columns: number): TextStyle {
  return { size: columns > 8 ? 7 : 8, color: 'ink' };
}

/**
 * A cell's words. On a flagged row the judged cell says WHY it is marked, in
 * words and bold ("34% · acima da meta"), so the mark survives a black-and-white print.
 */
function cellOf(
  ctx: PdfPaintContext,
  data: PdfTableData,
  rowIndex: number,
  column: PdfTableColumn,
): { text: string; bold: boolean } {
  const text = cellText(data.rows[rowIndex]?.[column.key], column, ctx);
  const marked = data.flag?.rows.has(rowIndex) === true && data.flag.column === column.key;
  return marked && data.flag ? { text: `${text} \u00b7 ${data.flag.label}`, bold: true } : { text, bold: false };
}

/** Column widths that share `width` in proportion to what each column's text needs. */
function columnWidths(ctx: PdfPaintContext, data: PdfTableData, width: number): number[] {
  const body = bodyStyle(data.columns.length);
  const head: TextStyle = { ...body, bold: true };
  const natural = data.columns.map((column) => {
    const cells = data.rows
      .slice(0, SAMPLE_ROWS)
      .map((_, index) => ctx.canvas.width(cellOf(ctx, data, index, column).text.slice(0, WIDTH_PROBE_CHARS), head));
    const widest = Math.max(ctx.canvas.width(column.label.slice(0, WIDTH_PROBE_CHARS), head), ...cells);
    return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, widest + PAD * 3));
  });
  const total = natural.reduce((sum, value) => sum + value, 0);
  return natural.map((value) => (value * width) / total);
}

function alignOf(column: PdfTableColumn): 'left' | 'right' {
  return column.align ?? (isNumericFormat(column.format) ? 'right' : 'left');
}

function drawCellText(
  ctx: PdfPaintContext,
  text: string,
  column: PdfTableColumn,
  box: { x: number; width: number; top: number },
  style: TextStyle,
): void {
  const fitted = ctx.canvas.fit(text, style, box.width - PAD * 2);
  const right = alignOf(column) === 'right';
  const x = right ? box.x + box.width - PAD : box.x + PAD;
  ctx.canvas.text(fitted, x, box.top + (ROW_HEIGHT - style.size) / 2, style, { align: right ? 'right' : 'left' });
}

function drawColumnHead(ctx: PdfPaintContext, data: PdfTableData, widths: number[], x: number, width: number): void {
  const { canvas } = ctx;
  const style: TextStyle = { ...bodyStyle(data.columns.length), bold: true };
  canvas.rect(x, canvas.cursor, width, HEAD_HEIGHT, 'card');
  let left = x;
  data.columns.forEach((column, index) => {
    const box = { x: left, width: widths[index] ?? 0, top: canvas.cursor + (HEAD_HEIGHT - ROW_HEIGHT) / 2 };
    drawCellText(ctx, column.label, column, box, style);
    left += box.width;
  });
  canvas.line({ x, top: canvas.cursor + HEAD_HEIGHT }, { x: x + width, top: canvas.cursor + HEAD_HEIGHT }, 'rule');
  canvas.cursor += HEAD_HEIGHT;
}

function drawRow(
  ctx: PdfPaintContext,
  data: PdfTableData,
  widths: number[],
  index: number,
  box: { x: number; width: number },
): void {
  const { canvas } = ctx;
  if (index % 2 === 1) canvas.rect(box.x, canvas.cursor, box.width, ROW_HEIGHT, 'zebra');
  let left = box.x;
  data.columns.forEach((column, at) => {
    const cell = { x: left, width: widths[at] ?? 0, top: canvas.cursor };
    const { text, bold } = cellOf(ctx, data, index, column);
    drawCellText(ctx, text, column, cell, { ...bodyStyle(data.columns.length), bold });
    left += cell.width;
  });
  canvas.cursor += ROW_HEIGHT;
}

function drawNote(ctx: PdfPaintContext, text: string, x: number): void {
  const { canvas } = ctx;
  canvas.ensure(NOTE.size * 2);
  canvas.text(text, x, canvas.cursor + 3, NOTE);
  canvas.cursor += NOTE.size * 2 + 3;
}

/** Whether `index` may be drawn here, or the table has to be cut at this page. */
function placeRow(ctx: PdfPaintContext, redraw: () => void, more: boolean): boolean {
  const { canvas } = ctx;
  const reserve = !canvas.canAddPage() && more ? NOTE.size * 2 + 3 : 0;
  if (ROW_HEIGHT + reserve <= canvas.remaining) return true;
  if (!canvas.canAddPage()) return false;
  canvas.newPage();
  redraw();
  return true;
}

/**
 * A table across as many pages as it takes, the column headings repeated on
 * each. Two ceilings cut it, and each says how much is missing: the per-table
 * row cap, and the document's page ceiling.
 */
export function drawTable(ctx: PdfPaintContext, block: ReportPdfBlock, data: PdfTableData, width: number): void {
  const { canvas } = ctx;
  const x = MARGIN_X;
  const header = headerFor(ctx, block, width);
  canvas.ensure(header.height + HEAD_HEIGHT + ROW_HEIGHT * 2);
  drawHeader(ctx, header, x, canvas.cursor);
  canvas.cursor += header.height;
  const widths = columnWidths(ctx, data, width);
  const redraw = (): void => drawColumnHead(ctx, data, widths, x, width);
  redraw();
  if (data.rows.length === 0) {
    drawNote(ctx, ctx.copy.empty, x);
    return;
  }
  const limit = Math.min(data.rows.length, ctx.maxTableRows);
  let drawn = 0;
  while (drawn < limit && placeRow(ctx, redraw, drawn + 1 < data.rows.length)) {
    drawRow(ctx, data, widths, drawn, { x, width });
    drawn += 1;
    canvas.tick();
  }
  if (drawn < data.rows.length) drawNote(ctx, ctx.copy.moreRows(data.rows.length - drawn, ctx.appName), x);
  canvas.cursor += 10;
}
