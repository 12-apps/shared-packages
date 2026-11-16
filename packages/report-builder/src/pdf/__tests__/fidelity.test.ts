import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderReportPdf, ReportPdfError, type ReportPdfOptions, type ReportPdfView } from '..';
import { PdfCanvas } from '../canvas';
import { createPdfPalette } from '../theme';
import {
  BASE_OPTIONS,
  barBlock,
  heatmapBlock,
  kpiBlock,
  tableBlock,
} from './models';

const LIMITS = { maxPages: 5, timeoutMs: 1_000_000 };

async function canvas(): Promise<PdfCanvas> {
  return PdfCanvas.create(LIMITS, () => 0);
}

function words(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]).replace(/[\u00a0\u202f]/g, ' '));
}

async function render(view: ReportPdfView, options: Partial<ReportPdfOptions> = {}) {
  const text = vi.spyOn(PdfCanvas.prototype, 'text');
  const result = await renderReportPdf(view, { ...BASE_OPTIONS, ...options });
  return { said: words(text), result };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what a person types prints', () => {
  it('keeps accents, the minus sign, Latin Extended, quotes and currency', async () => {
    const page = await canvas();
    const typed = '\u2212 \u0141\u00f3d\u017a \u201cx\u201d \u00e7\u00e3o \u00d7 \u20ac \u2022 \u2026';
    expect(page.clean(typed)).toBe(typed);
  });

  it('writes arrows and comparisons the face lacks as the ASCII that says the same, and drops ticks', async () => {
    const page = await canvas();
    expect(page.clean('a \u2192 b \u2265 1 \u2264 2 \u2248 3 \u2713').trim()).toBe('a -> b >= 1 <= 2 ~ 3');
  });

  it('drops what the face has no glyph for, and never prints a question mark', async () => {
    const page = await canvas();
    expect(page.clean('Bar 🍺 do Zé')).toBe('Bar do Zé');
    expect(page.clean('a‍b️c')).toBe('abc');
    expect(page.clean('日本')).not.toContain('?');
  });

  it('composes a decomposed accent, so macOS-typed "ação" prints whole', async () => {
    const page = await canvas();
    const decomposed = 'ção';
    expect(decomposed).not.toBe('ção');
    expect(page.clean(`a${decomposed}`)).toBe('ação');
  });

  it('sets the typed title and store name into the document without failing', async () => {
    const { said, result } = await render(
      { blocks: [] },
      { title: 'Custo “semanal” → meta ≥ 30% 🍺', storeName: 'Bar do Zé Łódź' },
    );
    expect(result.pageCount).toBe(1);
    expect(said.join(' ')).toContain('Bar do Zé Łódź');
  });
});

describe('a long cell cannot stall the render', () => {
  it('draws 300 rows of a 2,000-character cell inside the limit', async () => {
    const block = tableBlock('long', 300);
    if (block.status !== 'ok' || block.render.kind !== 'table') throw new Error('fixture');
    const rows = block.render.rows.map((row) => ({ ...row, person: 'palavra '.repeat(250) }));
    const started = performance.now();
    const { result } = await render({ blocks: [{ ...block, render: { ...block.render, rows } }] }, { limits: { maxPages: 40 } });
    expect(result.pageCount).toBeGreaterThan(1);
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it('fits a 50,000-character word without measuring all of it', async () => {
    const page = await canvas();
    const started = performance.now();
    const fitted = page.fit('x'.repeat(50_000), { size: 8 }, 120);
    expect(fitted.endsWith('…')).toBe(true);
    expect(page.width(fitted, { size: 8 })).toBeLessThanOrEqual(120);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('wraps a long unbroken text to its lines', async () => {
    const page = await canvas();
    const lines = page.wrap('palavra '.repeat(5000), { size: 8 }, 200, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('checks the clock on every row, so a tiny budget stops a table as a typed timeout', async () => {
    const clock = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValue(5);
    const error = await renderReportPdf({ blocks: [tableBlock('t', 200)] }, { ...BASE_OPTIONS, limits: { timeoutMs: 1 }, clock }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ReportPdfError);
    expect((error as ReportPdfError).code).toBe('timeout');
  });

  it('keeps a default limit when the caller leaves it undefined', async () => {
    const { result } = await render({ blocks: [kpiBlock('k', 12, 'Receita', 100)] }, { limits: { maxPages: undefined } });
    expect(result.pageCount).toBe(1);
  });
});

describe('the heat map says which cells are above the target', () => {
  it('outlines each cell above the target, twice as heavy when strongly above, and prints the legend words', async () => {
    const outline = vi.spyOn(PdfCanvas.prototype, 'outline');
    const hatch = vi.spyOn(PdfCanvas.prototype, 'hatch');
    const { said } = await render({ blocks: [heatmapBlock('h')] });
    const thickness = outline.mock.calls.map((call) => call[5]);
    // 0.52 and 0.64 are strongly above (> 0.5); 0.31 and 0.41 are above; 0.30 is on target.
    expect(thickness.filter((value) => value === 1.4)).toHaveLength(2);
    expect(thickness.filter((value) => value === 0.8).length).toBeGreaterThanOrEqual(2 + 1);
    expect(hatch).toHaveBeenCalled();
    expect(said).toEqual(expect.arrayContaining(['acima da meta', 'na meta ou abaixo', 'sem venda', 'sem custo na hora']));
  });

  it('marks an hour with no sale and an hour with no priced cost differently', async () => {
    const { said } = await render({ blocks: [heatmapBlock('h')] });
    expect(said).toContain('—');
    expect(said).toContain('(—)');
  });
});

describe('a flagged row is never marked by colour alone', () => {
  it('says why in the judged cell, in words', async () => {
    const { said } = await render({ blocks: [tableBlock('t', 12, 5)] });
    expect(said.filter((word) => word.endsWith('· Acima da meta'))).toHaveLength(3);
  });
});

describe('the colours come from the theme', () => {
  it('takes the accents from the UI theme, and the store brand overrides the primary', () => {
    const base = createPdfPalette();
    const branded = createPdfPalette({ brand: { primary: '#ff0000' } });
    expect(branded.accents.primary).toMatchObject({ red: 1, green: 0, blue: 0 });
    expect(base.accents.primary).not.toMatchObject({ red: 1, green: 0, blue: 0 });
    expect(branded.accents.success).toEqual(base.accents.success);
  });

  it('paints a chart series with the brand the host passes', async () => {
    const rect = vi.spyOn(PdfCanvas.prototype, 'rect');
    await render({ blocks: [barBlock('b', 12)] }, { brand: { primary: '#ff0000' } });
    const fills = rect.mock.calls.map((call) => call[4]);
    expect(fills.some((fill) => typeof fill === 'object' && 'red' in fill && fill.red === 1)).toBe(true);
  });
});

describe('layout details', () => {
  it('lets the last tile of a row reach the content edge', async () => {
    const rect = vi.spyOn(PdfCanvas.prototype, 'rect');
    await render({ blocks: [kpiBlock('a', 6, 'A', 1), kpiBlock('b', 6, 'B', 2)] });
    const cards = rect.mock.calls.filter((call) => call[4] === 'card');
    const last = cards[cards.length - 1];
    expect((last?.[0] as number) + (last?.[2] as number)).toBeCloseTo(595.28 - 40, 1);
  });

  it('prints no spec sentence above a tile, and wraps a long title instead of cutting it', async () => {
    const tile = { ...kpiBlock('k', 12, 'Receita', 100), title: 'Receita bruta das vendas confirmadas e pagas no período anterior ao fechamento do caixa' };
    const { said } = await render({ blocks: [tile] });
    expect(said).not.toContain('soma de custo por dia');
    expect(said.filter((word) => word.endsWith('…'))).toHaveLength(0);
    expect(said.filter((word) => word.startsWith('Receita bruta') || word.includes('fechamento do caixa')).length).toBeGreaterThanOrEqual(1);
  });

  it('writes money in whole reais, as the screen does', async () => {
    const { said } = await render({ blocks: [kpiBlock('k', 12, 'Receita', 968000)] });
    expect(said).toContain('R$ 9.680');
  });

  it('hatches the second series, so two accents differ by more than hue', async () => {
    const hatch = vi.spyOn(PdfCanvas.prototype, 'hatch');
    await render({ blocks: [barBlock('b', 12, true)] });
    expect(hatch.mock.calls.length).toBeGreaterThan(7);
  });

  it('uses one footer separator style, the one the heading uses', async () => {
    const { said } = await render({ blocks: [] });
    expect(said.some((word) => word.includes('Loja Modelo | Custo'))).toBe(true);
  });

  it('carries the two e-mail sentences a host picks between', async () => {
    const { REPORT_PDF_COPY } = await import('..');
    expect(REPORT_PDF_COPY['pt-BR'].missingLine).not.toBe(REPORT_PDF_COPY['pt-BR'].attachedLine);
    expect(REPORT_PDF_COPY['en-US'].missingLine).toContain('PDF');
  });
});
