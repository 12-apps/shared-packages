import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderReportPdf, ReportPdfError, type ReportPdfBlock, type ReportPdfOptions, type ReportPdfView } from '..';
import { PdfCanvas } from '../canvas';
import {
  BASE_OPTIONS,
  ERROR_BLOCK,
  LABOUR_BLOCKS,
  SALES_BLOCKS,
  barBlock,
  donutBlock,
  emptyChartBlock,
  heatmapBlock,
  kpiBlock,
  lineBlock,
  tableBlock,
} from './models';

interface Drawn {
  text: string;
  x: number;
  top: number;
}

/** Render while recording every string the canvas writes, in drawing order. */
async function draw(
  view: ReportPdfView,
  options: Partial<ReportPdfOptions> = {},
): Promise<{ drawn: Drawn[]; result: Awaited<ReturnType<typeof renderReportPdf>> }> {
  const spy = vi.spyOn(PdfCanvas.prototype, 'text');
  const result = await renderReportPdf(view, { ...BASE_OPTIONS, ...options });
  const drawn = spy.mock.calls.map(([text, x, top]) => ({ text: text.replace(/[\u00a0\u202f]/g, ' '), x, top }));
  return { drawn, result };
}

const said = (drawn: Drawn[]): string[] => drawn.map((entry) => entry.text);
const placeOf = (drawn: Drawn[], label: string): Drawn | undefined => drawn.find((entry) => entry.text === label);
const timesDrawn = (drawn: Drawn[], label: string): number => drawn.filter((entry) => entry.text === label).length;

async function failure(view: ReportPdfView, options: Partial<ReportPdfOptions> = {}): Promise<ReportPdfError> {
  try {
    await renderReportPdf(view, { ...BASE_OPTIONS, ...options });
  } catch (error) {
    if (error instanceof ReportPdfError) return error;
    throw error;
  }
  throw new Error('expected the render to fail');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderReportPdf: the blocks', () => {
  it('draws KPI tiles, a chart and a table into a PDF a reader can open', async () => {
    const { result, drawn } = await draw({ blocks: LABOUR_BLOCKS });
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(result.sizeBytes).toBe(result.bytes.length);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(result.pageCount);
    const words = said(drawn);
    expect(words).toContain('R$ 48.200');
    expect(words).toContain('Custo total');
    expect(words).toContain('Colaborador 1');
    // A declared value label, not the stored key, and a duration at its declared precision.
    expect(words).toContain('Cozinha');
    expect(words).not.toContain('cook');
    expect(words).toContain('30 h');
    expect(words).toContain('R$ 1.500 \u00b7 Acima da meta');
  });

  it('puts tiles that share a 12-column row on one line', async () => {
    const { drawn } = await draw({ blocks: LABOUR_BLOCKS.slice(0, 3) });
    const tops = ['Custo total', 'Horas pagas', 'Custo sobre vendas'].map(
      (label) => placeOf(drawn, label)?.top,
    );
    expect(new Set(tops).size).toBe(1);
    const lefts = ['Custo total', 'Horas pagas', 'Custo sobre vendas'].map(
      (label) => placeOf(drawn, label)?.x ?? 0,
    );
    expect(lefts[0]).toBeLessThan(lefts[1] ?? 0);
    expect(lefts[1]).toBeLessThan(lefts[2] ?? 0);
  });

  it('writes the chart axes: category labels, a money axis, the legend and the axis title', async () => {
    const { drawn } = await draw({ blocks: [barBlock('b', 12, true)] });
    const words = said(drawn);
    expect(words).toEqual(expect.arrayContaining(['seg', 'dom', 'Cozinha', 'Salão', 'Custo', 'Dia']));
    expect(words.some((word) => /^R\$ ?\d+(,\d)? mil$/.test(word))).toBe(true);
  });

  it('draws line, area, donut and heat map blocks, and a single report given as one render model', async () => {
    const blocks = [lineBlock('l', 12), lineBlock('a', 12, 'area'), donutBlock('d', 12), heatmapBlock('h')];
    const { result, drawn } = await draw({ blocks });
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    const words = said(drawn);
    expect(words).toContain('PIX');
    expect(words).toContain('49,4%');
    expect(words).toContain('Total');
    expect(words).toContain('52%');
    const single = lineBlock('only', 12);
    if (single.status !== 'ok') throw new Error('fixture');
    const alone = await renderReportPdf({ render: single.render }, BASE_OPTIONS);
    expect(alone.pageCount).toBe(1);
  });

  it('shows a failed block as a plain note, never the engine message', async () => {
    const { drawn } = await draw({ blocks: [ERROR_BLOCK, kpiBlock('k', 12, 'Receita', 100)] });
    const words = said(drawn);
    expect(words).toContain('Este bloco não pôde ser exibido.');
    expect(words).toContain('Receita');
  });


});

describe('renderReportPdf: an empty report', () => {
  it('is one page that says there is no data, with the heading and the period', async () => {
    const { result, drawn } = await draw({ blocks: [] });
    expect(result.pageCount).toBe(1);
    const words = said(drawn);
    expect(words).toContain('Sem dados neste período.');
    expect(words).toContain('Custo de mão de obra');
    expect(words.join(' ')).toContain('Período: 9 a 15/11/2026');
  });

  it('says so inside a table with no rows and a chart with no points', async () => {
    const { drawn } = await draw({ blocks: [tableBlock('t', 0), emptyChartBlock('c')] });
    expect(said(drawn).filter((word) => word === 'Sem dados neste período.')).toHaveLength(2);
  });
});

describe('renderReportPdf: the labels follow the locale', () => {
  it('writes pt-BR page furniture', async () => {
    const { drawn } = await draw({ blocks: SALES_BLOCKS });
    const words = said(drawn);
    expect(words).toContain('Página 1 de 1');
    expect(words.join(' ')).toContain('Loja: Loja Modelo');
    expect(words.join(' ')).toContain('Gerado em: 16/11/2026 08:00');
  });

  it('writes en-US page furniture, the stamp in month-first order on the store clock', async () => {
    const { drawn } = await draw({ blocks: SALES_BLOCKS }, { locale: 'en-US' });
    const words = said(drawn);
    expect(words).toContain('Page 1 of 1');
    expect(words.join(' ')).toContain('Store: Loja Modelo');
    expect(words.join(' ')).toContain('Generated: 11/16/2026 08:00');
  });

  it('lets the host reword the cut-table note and name its own app', async () => {
    const { drawn } = await draw(
      { blocks: [tableBlock('t', 50)] },
      { limits: { maxTableRows: 10 }, locale: 'en-US', appName: 'the dashboard' },
    );
    expect(said(drawn)).toContain('and 40 more rows — see them in the dashboard');
  });
});

describe('renderReportPdf: the ceilings', () => {
  it('cuts a long table with "e mais N linhas — veja no <app>"', async () => {
    const { drawn, result } = await draw({ blocks: [tableBlock('t', 1000)] }, { limits: { maxTableRows: 120 } });
    expect(said(drawn)).toContain('e mais 880 linhas — veja no Acme');
    expect(said(drawn)).not.toContain('Colaborador 121');
    expect(result.pageCount).toBeGreaterThan(1);
  });

  it('repeats the column headings on every page a table spans', async () => {
    const { drawn, result } = await draw({ blocks: [tableBlock('t', 100)] });
    expect(timesDrawn(drawn, 'Pessoa')).toBe(result.pageCount);
  });

  it('cuts a table at the page ceiling instead of failing, and still says how much is missing', async () => {
    const { drawn, result } = await draw(
      { blocks: [tableBlock('t', 400)] },
      { limits: { maxPages: 2, maxTableRows: 400 } },
    );
    expect(result.pageCount).toBe(2);
    const note = said(drawn).find((word) => word.startsWith('e mais '));
    expect(note).toMatch(/^e mais \d+ linhas — veja no Acme$/);
  });

  it('refuses a document that needs more pages than the ceiling, as too_large', async () => {
    const blocks = Array.from({ length: 12 }, (_, index) => barBlock(`b${index}`, 12));
    const error = await failure({ blocks }, { limits: { maxPages: 1 } });
    expect(error.code).toBe('too_large');
    expect(error.pageCount).toBe(2);
  });

  it('refuses a file over the size ceiling, as too_large, and reports its size', async () => {
    const error = await failure({ blocks: LABOUR_BLOCKS }, { limits: { maxBytes: 1000 } });
    expect(error.code).toBe('too_large');
    expect(error.sizeBytes).toBeGreaterThan(1000);
  });

  it('gives up on a spent budget, as timeout', async () => {
    // The first reading starts the budget; every later one is a minute on.
    const clock = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValue(60_000);
    const error = await failure({ blocks: LABOUR_BLOCKS }, { limits: { timeoutMs: 50 }, clock });
    expect(error.code).toBe('timeout');
  });
});

describe('renderReportPdf: typed failures', () => {
  it('names a block whose chart type it cannot draw, as unsupported_block', async () => {
    const block = lineBlock('radar-1', 12);
    if (block.status !== 'ok' || block.render.kind !== 'chart') throw new Error('fixture');
    const odd = { ...block, render: { ...block.render, chartSpec: { ...block.render.chartSpec, type: 'radar' } } };
    const error = await failure({ blocks: [odd as unknown as ReportPdfBlock] });
    expect(error.code).toBe('unsupported_block');
    expect(error.blockId).toBe('radar-1');
  });

  it('names a render kind it does not know, as unsupported_block', async () => {
    const odd = { id: 'x', status: 'ok', render: { kind: 'sankey' } } as unknown as ReportPdfBlock;
    expect((await failure({ blocks: [odd] })).code).toBe('unsupported_block');
  });

  it('turns anything else that goes wrong into render_failed, keeping the cause', async () => {
    const table = tableBlock('t', 3);
    if (table.status !== 'ok' || table.render.kind !== 'table') throw new Error('fixture');
    const [first, ...rest] = table.render.columns;
    const columns = [{ ...(first as NonNullable<typeof first>), bucketFormat: 'day' }, ...rest];
    const error = await failure(
      { blocks: [{ ...table, render: { ...table.render, columns } }] },
      {
        formatBucket: () => {
          throw new Error('host formatter blew up');
        },
      },
    );
    expect(error.code).toBe('render_failed');
    expect((error.cause as Error).message).toBe('host formatter blew up');
  });
});

describe('renderReportPdf: determinism and metadata', () => {
  it('gives the same bytes for the same input', async () => {
    const first = await renderReportPdf({ blocks: SALES_BLOCKS }, BASE_OPTIONS);
    const second = await renderReportPdf({ blocks: SALES_BLOCKS }, BASE_OPTIONS);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  it('takes every date in the file from the input', async () => {
    const result = await renderReportPdf({ blocks: SALES_BLOCKS }, BASE_OPTIONS);
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reopened.getCreationDate()?.toISOString()).toBe('2026-11-16T11:00:00.000Z');
    expect(reopened.getModificationDate()?.toISOString()).toBe('2026-11-16T11:00:00.000Z');
    expect(reopened.getTitle()).toBe('Custo de mão de obra');
    expect(reopened.getAuthor()).toBe('Loja Modelo');
  });

  it('changes only because the input changed', async () => {
    const first = await renderReportPdf({ blocks: SALES_BLOCKS }, BASE_OPTIONS);
    const later = await renderReportPdf({ blocks: SALES_BLOCKS }, { ...BASE_OPTIONS, generatedAt: new Date('2026-11-23T11:00:00Z') });
    expect(Buffer.from(first.bytes).equals(Buffer.from(later.bytes))).toBe(false);
  });
});
