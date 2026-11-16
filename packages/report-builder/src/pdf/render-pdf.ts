import type { ValueFormatCopy } from '../copy';
import { EN_US_REPORT_ENGINE_COPY } from '../en-US';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import type { ReportRenderModel } from '../render';
import { PdfCanvas, CONTENT_WIDTH, MARGIN_X } from './canvas';
import type { ReportPdfCopy } from './copy';
import { CHART_TYPES } from './chart-data';
import { drawChart, chartHeight } from './draw-chart';
import { drawHeatmap } from './draw-heatmap';
import { drawKpi, kpiHeight } from './draw-kpi';
import { drawTable, type PdfTableData } from './draw-table';
import { drawFooters, drawTitleBlock, setMetadata, type DocumentFacts } from './document';
import { ReportPdfError, toReportPdfError } from './errors';
import { drawHeader, headerFor } from './header';
import { reportPdfCopyFor } from './packs';
import type { ReportPdfTheme } from './theme';
import type { PdfPaintContext, ReportPdfBlock, ReportPdfBucketFormatter, ReportPdfView } from './types';

export interface ReportPdfLimits {
  /** Pages the document may reach before it is refused as `too_large`. Default 40. */
  maxPages?: number;
  /** Bytes the finished file may reach before it is refused as `too_large`. Default 7 000 000. */
  maxBytes?: number;
  /** Wall-clock budget for the whole render, in ms. Default 60 000. */
  timeoutMs?: number;
  /** Rows a table draws before it is cut with a "and N more" note. Default 300. */
  maxTableRows?: number;
  /** Points a chart draws before the rest is left off. Default 120. */
  maxChartPoints?: number;
}

export interface ReportPdfOptions extends ReportPdfTheme {
  /** The report's name: the page heading, the footer and the file's title. */
  title: string;
  /** The period as a person reads it ("9 a 15/11"). The host words it, on its own clock. */
  periodLabel: string;
  storeName: string;
  /** BCP-47 tag; picks the package's pt-BR or en-US words. */
  locale: string;
  /** IANA zone the "generated" stamp is written in. */
  timeZone: string;
  /** Written into the file's metadata and the first page; the renderer never reads the clock itself. */
  generatedAt: Date;
  /** What the cut-table note calls the place the full report lives ("veja no <appName>"). */
  appName?: string;
  /** Overrides on top of the locale's pack. */
  copy?: Partial<ReportPdfCopy>;
  /** The engine's cell words, when they are not the locale's own. */
  values?: ValueFormatCopy;
  formatBucket?: ReportPdfBucketFormatter;
  limits?: ReportPdfLimits;
  /** A millisecond clock; a test's way to spend the budget. Default `Date.now`. */
  clock?: () => number;
}

export interface ReportPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  sizeBytes: number;
}

export const DEFAULT_PDF_LIMITS = {
  maxPages: 40,
  maxBytes: 7_000_000,
  timeoutMs: 60_000,
  maxTableRows: 300,
  maxChartPoints: 120,
} as const satisfies Required<ReportPdfLimits>;

const BLOCK_GAP = 14;
const COLUMN_GAP = 12;
const GRID = 12;

function blocksOf(view: ReportPdfView): readonly ReportPdfBlock[] {
  if ('blocks' in view) return view.blocks;
  return [{ id: 'report', status: 'ok', render: view.render, ...(view.sentence ? { sentence: view.sentence } : {}) }];
}

/** Only tiles and charts share a row; everything else takes the full width. */
function isInline(block: ReportPdfBlock): boolean {
  return block.status === 'ok' && (block.render.kind === 'kpi' || block.render.kind === 'chart');
}

function spanOf(block: ReportPdfBlock): number {
  return Math.min(GRID, Math.max(1, Math.round(block.span ?? GRID)));
}

/** Consecutive inline blocks fill a 12-column row; anything else closes it. */
function layoutRows(blocks: readonly ReportPdfBlock[]): ReportPdfBlock[][] {
  const rows: ReportPdfBlock[][] = [];
  let used = 0;
  for (const block of blocks) {
    const last = rows[rows.length - 1];
    const joins = isInline(block) && last !== undefined && isInline(last[0] as ReportPdfBlock) && used + spanOf(block) <= GRID;
    if (joins && last) {
      last.push(block);
      used += spanOf(block);
    } else {
      rows.push([block]);
      used = isInline(block) ? spanOf(block) : GRID;
    }
  }
  return rows;
}

function bodyHeight(ctx: PdfPaintContext, render: ReportRenderModel, width: number): number {
  if (render.kind === 'kpi') return kpiHeight(render, width);
  if (render.kind === 'chart') return chartHeight(ctx, render, width);
  return 0;
}

function drawInlineRow(ctx: PdfPaintContext, row: readonly ReportPdfBlock[]): void {
  const { canvas } = ctx;
  const columns = row.map((block, index) => {
    const before = row.slice(0, index).reduce((sum, other) => sum + spanOf(other), 0);
    return {
      block,
      x: MARGIN_X + (CONTENT_WIDTH * before) / GRID,
      // Every tile but the last leaves a gutter; the last reaches the content edge.
      width: (CONTENT_WIDTH * spanOf(block)) / GRID - (index < row.length - 1 ? COLUMN_GAP : 0),
    };
  });
  const measured = columns.map((column) => {
    const render = column.block.status === 'ok' ? column.block.render : null;
    const header = headerFor(ctx, column.block, column.width, { sentence: render?.kind !== 'kpi' });
    return { ...column, header, body: render ? bodyHeight(ctx, render, column.width) : 0 };
  });
  const height = Math.max(...measured.map((entry) => entry.header.height + entry.body));
  canvas.ensure(height);
  const top = canvas.cursor;
  const bodyTop = Math.max(...measured.map((entry) => entry.header.height));
  for (const entry of measured) {
    drawHeader(ctx, entry.header, entry.x, top);
    if (entry.block.status !== 'ok') continue;
    if (entry.block.render.kind === 'kpi') {
      drawKpi(ctx, entry.block.render, entry.x, top + entry.header.height, entry.width, entry.body);
    } else if (entry.block.render.kind === 'chart') {
      drawChart(ctx, entry.block.render, { x: entry.x, top: top + entry.header.height, width: entry.width });
    }
  }
  canvas.cursor = top + Math.max(height, bodyTop) + BLOCK_GAP;
}

function drawErrorBlock(ctx: PdfPaintContext, block: ReportPdfBlock): void {
  const header = headerFor(ctx, block, CONTENT_WIDTH);
  ctx.canvas.ensure(header.height + 20);
  drawHeader(ctx, header, MARGIN_X, ctx.canvas.cursor);
  ctx.canvas.cursor += header.height;
  ctx.canvas.text(ctx.copy.blockError, MARGIN_X, ctx.canvas.cursor, { size: 8.5, color: 'muted' });
  ctx.canvas.cursor += 12 + BLOCK_GAP;
}

function unsupported(block: ReportPdfBlock): ReportPdfError {
  return new ReportPdfError('unsupported_block', `Block "${block.id}" has a render this PDF cannot draw.`, {
    blockId: block.id,
  });
}

function drawFullWidth(ctx: PdfPaintContext, block: ReportPdfBlock): void {
  if (block.status !== 'ok') throw unsupported(block);
  const { render } = block;
  if (render.kind === 'heatmap') return drawHeatmap(ctx, block, render, CONTENT_WIDTH);
  if (render.kind !== 'table') throw unsupported(block);
  const data: PdfTableData = {
    columns: render.columns,
    rows: render.rows,
    ...(render.flag ? { flag: { column: render.flag.column, label: render.flag.label, rows: new Set(render.flag.rows) } } : {}),
  };
  drawTable(ctx, block, data, CONTENT_WIDTH);
}

function drawBlockRow(ctx: PdfPaintContext, row: readonly ReportPdfBlock[]): void {
  const first = row[0];
  if (!first) return;
  if (first.status === 'error') drawErrorBlock(ctx, first);
  else if (isInline(first)) drawInlineRow(ctx, row);
  else drawFullWidth(ctx, first);
}

function assertDrawable(blocks: readonly ReportPdfBlock[]): void {
  for (const block of blocks) {
    if (block.status !== 'ok') continue;
    const { render } = block;
    const kinds = ['table', 'heatmap', 'kpi', 'chart'];
    const known = kinds.includes(render.kind) && (render.kind !== 'chart' || CHART_TYPES.includes(render.chartSpec.type));
    if (!known) throw unsupported(block);
  }
}

/** A limit left `undefined` keeps its default instead of replacing it with nothing. */
function definedOnly(limits: ReportPdfLimits | undefined): Partial<ReportPdfLimits> {
  return Object.fromEntries(Object.entries(limits ?? {}).filter(([, value]) => value !== undefined));
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function build(view: ReportPdfView, options: ReportPdfOptions): Promise<ReportPdfResult> {
  const limits = { ...DEFAULT_PDF_LIMITS, ...definedOnly(options.limits) };
  const clock = options.clock ?? Date.now;
  const blocks = blocksOf(view);
  assertDrawable(blocks);
  const canvas = await PdfCanvas.create(limits, clock, {
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.brand ? { brand: options.brand } : {}),
  });
  const copy = { ...reportPdfCopyFor(options.locale), ...options.copy };
  const ctx: PdfPaintContext = {
    canvas,
    copy,
    appName: options.appName ?? copy.defaultAppName,
    values: options.values ?? engineValuesFor(options.locale),
    ...(options.formatBucket ? { formatBucket: options.formatBucket } : {}),
    maxTableRows: limits.maxTableRows,
    maxChartPoints: limits.maxChartPoints,
  };
  const facts: DocumentFacts = { ...options };
  setMetadata(canvas, facts);
  drawTitleBlock(canvas, facts, copy);
  if (blocks.length === 0) canvas.text(copy.empty, MARGIN_X, canvas.cursor, { size: 11, color: 'muted' });
  for (const row of layoutRows(blocks)) {
    canvas.tick();
    drawBlockRow(ctx, row);
    await yieldToLoop();
  }
  drawFooters(canvas, facts, copy);
  canvas.tick();
  const bytes = await canvas.doc.save();
  canvas.tick();
  if (bytes.length > limits.maxBytes) {
    throw new ReportPdfError('too_large', `The report PDF is ${bytes.length} bytes, over ${limits.maxBytes}.`, {
      sizeBytes: bytes.length,
      pageCount: canvas.pageCount,
    });
  }
  return { bytes, pageCount: canvas.pageCount, sizeBytes: bytes.length };
}

function engineValuesFor(locale: string): ValueFormatCopy {
  return (locale.toLowerCase().startsWith('en') ? EN_US_REPORT_ENGINE_COPY : PT_BR_REPORT_ENGINE_COPY).values;
}

/**
 * A saved report's render model as a PDF, drawn with vector shapes: no
 * browser, no network, no font file. The same input gives the same bytes; the
 * only dates in the file are the one the caller passes.
 *
 * It fails fast and typed: a {@link ReportPdfError} with `timeout`,
 * `too_large`, `unsupported_block` or `render_failed`, so a delivery job can
 * send the e-mail without the attachment and say why.
 */
export async function renderReportPdf(view: ReportPdfView, options: ReportPdfOptions): Promise<ReportPdfResult> {
  try {
    return await build(view, options);
  } catch (error) {
    throw toReportPdfError(error);
  }
}
