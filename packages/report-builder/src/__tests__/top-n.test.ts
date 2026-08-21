import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { createMemoryDataSource, executeCompiledQuery, OTHERS_BUCKET_LABEL } from '../memory';
import { runReport } from '../run';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { defineCatalog } from '../catalog';

/**
 * FUT-391 top-N: the leaders, plus everything else folded into "Outros".
 *
 * Before this, `limit` truncated — a top-5 over twelve products silently
 * discarded seven, so the chart stopped adding up to the report's own total
 * and nothing said why.
 */
const catalog = defineCatalog({
  entities: {
    sales: {
      label: 'Vendas',
      fields: {
        product: { label: 'Produto', type: 'string', role: 'dimension' },
        method: { label: 'Forma', type: 'string', role: 'dimension' },
        cents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

/**
 * Twelve products, revenue descending: P01 = 1200 … P12 = 100.
 *
 * A FACTORY rather than a shared constant: the executor folds groups, and a
 * fixture shared across cases is how a fold that mutated its input would pass
 * here and fail in whichever test happened to run second.
 */
function salesRows() {
  return Array.from({ length: 12 }, (_, index) => ({
    product: `P${String(index + 1).padStart(2, '0')}`,
    method: index % 2 === 0 ? 'PIX' : 'CARD',
    cents: (12 - index) * 100,
  }));
}

/** 1200 + 1100 + … + 100. */
const TOTAL_CENTS = 7800;

function run(input: ReportSpecInput, rows = salesRows()) {
  const query = compileReport(reportSpecSchema.parse(input), catalog);
  return executeCompiledQuery(rows, query);
}

const TOP_5: ReportSpecInput = {
  entity: 'sales',
  dimensions: [{ field: 'product' }],
  measures: [{ field: 'cents' }],
  sort: [{ by: 'sum_cents', direction: 'desc' }],
  limit: 5,
};

describe('top-N with an "Outros" bucket', () => {
  it('returns N + 1 rows: the leaders and the remainder', () => {
    const rows = run(TOP_5);
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);
  });

  it('keeps the total intact — that is the whole point', () => {
    const rows = run(TOP_5);
    const shown = rows.reduce((total, row) => total + Number(row.sum_cents), 0);
    expect(shown).toBe(TOTAL_CENTS);
  });

  it('folds the TAIL of the requested ordering, not of insertion order', () => {
    const rows = run(TOP_5);
    // Sorted by revenue desc, the leaders are P01..P05 and "Outros" is P06..P12.
    expect(rows.slice(0, 5).map((row) => row.product)).toEqual([
      'P01',
      'P02',
      'P03',
      'P04',
      'P05',
    ]);
    expect(rows.at(-1)?.sum_cents).toBe(700 + 600 + 500 + 400 + 300 + 200 + 100);
  });

  it('adds no bucket when the groups already fit', () => {
    expect(run({ ...TOP_5, limit: 20 }).map((row) => row.product)).not.toContain(
      OTHERS_BUCKET_LABEL,
    );
  });

  it('adds no bucket when the spec asked for no limit', () => {
    // The 1000-row safety cap is truncation, not a top-N. Folding THAT
    // remainder would claim a total the report never computed.
    const rows = run({ entity: 'sales', dimensions: [{ field: 'product' }], measures: [{ field: 'cents' }] });
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.product)).not.toContain(OTHERS_BUCKET_LABEL);
  });

  it('honours the host’s row cap when the spec asks for MORE than it', async () => {
    // The regression: a spec-declared limit was clamped to `maxRows` and then
    // read as a top-N of exactly that, so the result folded and came back with
    // `maxRows + 1` rows — one MORE than the cap the host set, carrying an
    // "Outros" bucket nobody asked for. A caller asking for 10,000 rows on a
    // 5-row cap wants 10,000; what it gets is 5 truncated.
    //
    // Found by a CONSUMER (the origin host's run-route test), not here: no test in
    // this package had ever set `maxRows` below a spec's own limit.
    const result = await runReport(
      {
        entity: 'sales',
        dimensions: [{ field: 'product' }],
        measures: [{ field: 'cents' }],
        sort: [{ by: 'sum_cents', direction: 'desc' }],
        limit: 10_000,
      },
      { catalog, adapter: createMemoryDataSource({ sales: salesRows() }), maxRows: 5, copy: PT_BR_REPORT_ENGINE_COPY },
    );

    expect(result.render.rows).toHaveLength(5);
    expect(result.render.rows.map((row) => row.product)).not.toContain(OTHERS_BUCKET_LABEL);
  });

  it('treats a limit at or below the cap as the author’s top-N', async () => {
    // The other side of the same condition, and the boundary `<=` decides: a
    // limit that BINDS is a real top-N and must keep folding, or fixing the
    // above would silently remove the "Outros" bucket from every report with
    // one. The six rows here are the fold's own bound (topN + 1), not the
    // safety cap being exceeded.
    const result = await runReport(
      {
        entity: 'sales',
        dimensions: [{ field: 'product' }],
        measures: [{ field: 'cents' }],
        sort: [{ by: 'sum_cents', direction: 'desc' }],
        limit: 5,
      },
      { catalog, adapter: createMemoryDataSource({ sales: salesRows() }), maxRows: 5, copy: PT_BR_REPORT_ENGINE_COPY },
    );

    expect(result.render.rows).toHaveLength(6);
    expect(result.render.rows.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);
  });

  it('leaves a SPLIT query truncated rather than guessing a series', () => {
    // Groups are per (product, method) pair; one "Outros" row cannot say which
    // series it belongs to, so the plain cap stands until that is defined.
    const rows = run({
      entity: 'sales',
      dimensions: [{ field: 'product' }, { field: 'method' }],
      measures: [{ field: 'cents' }],
      sort: [{ by: 'sum_cents', direction: 'desc' }],
      limit: 5,
    });
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.product)).not.toContain(OTHERS_BUCKET_LABEL);
  });
});

describe('the bucket is exact, not a blend of finished values', () => {
  it('computes an average over the folded ROWS, not an average of averages', () => {
    // P06..P12 are 700,600,500,400,300,200,100 → mean 400. Averaging the seven
    // per-product averages happens to agree here, so use uneven group sizes:
    const rows = [
      { product: 'A', method: 'PIX', cents: 1000 },
      { product: 'B', method: 'PIX', cents: 10 },
      { product: 'B', method: 'PIX', cents: 10 },
      { product: 'B', method: 'PIX', cents: 10 },
      { product: 'C', method: 'PIX', cents: 100 },
    ];
    const out = run(
      {
        entity: 'sales',
        dimensions: [{ field: 'product' }],
        measures: [{ field: 'cents', aggregation: 'avg' }],
        sort: [{ by: 'avg_cents', direction: 'desc' }],
        limit: 1,
      },
      rows,
    );

    // Leader is A (1000). "Outros" folds B's three 10s and C's 100 → mean 32.5.
    // An average of the two group averages would be (10 + 100) / 2 = 55.
    expect(out.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);
    expect(out.at(-1)?.avg_cents).toBe(32.5);
  });

  it('counts distinct values across the whole remainder, not per group', () => {
    const rows = [
      { product: 'A', method: 'PIX', cents: 1 },
      { product: 'B', method: 'PIX', cents: 1 },
      { product: 'C', method: 'CARD', cents: 1 },
      { product: 'D', method: 'PIX', cents: 1 },
    ];
    const out = run(
      {
        entity: 'sales',
        dimensions: [{ field: 'product' }],
        measures: [{ field: 'method', aggregation: 'count_distinct' }],
        sort: [{ by: 'product', direction: 'asc' }],
        limit: 1,
      },
      rows,
    );

    // B, C and D fold together: {PIX, CARD} = 2 distinct, not 1 per group.
    expect(out.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);
    expect(out.at(-1)?.count_distinct_method).toBe(2);
  });

  it('takes the extremes of the whole remainder', () => {
    const out = run({
      entity: 'sales',
      dimensions: [{ field: 'product' }],
      measures: [
        { field: 'cents', aggregation: 'min', alias: 'lo' },
        { field: 'cents', aggregation: 'max', alias: 'hi' },
      ],
      sort: [{ by: 'hi', direction: 'desc' }],
      limit: 2,
    });

    // Leaders P01, P02; the rest span 100..1000.
    expect(out.at(-1)?.lo).toBe(100);
    expect(out.at(-1)?.hi).toBe(1000);
  });
});

describe('the memory data source honours it too', () => {
  it('folds through the published adapter seam', async () => {
    const source = createMemoryDataSource({ sales: salesRows() });
    const rows = await source.execute(compileReport(reportSpecSchema.parse(TOP_5), catalog));
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);
  });
});

describe('the bucket survives the whole pipeline', () => {
  /**
   * Regression: `runReport` re-caps the adapter's rows at `query.limit` as a
   * guard against an adapter over-returning. Since limit EQUALS topN, that
   * silently chopped the "Outros" row back off — every test that called
   * `executeCompiledQuery` directly passed while the public entry point was
   * still dropping the remainder. Only the consumer harness caught it.
   */
  it('reaches the caller through runReport, not just the executor', async () => {
    const result = await runReport(TOP_5, {
      catalog,
      adapter: createMemoryDataSource({ sales: salesRows() }),
      copy: PT_BR_REPORT_ENGINE_COPY,
    });

    expect(result.rows).toHaveLength(6);
    expect(result.rows.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);

    const shown = result.rows.reduce((total, row) => total + Number(row.sum_cents), 0);
    expect(shown).toBe(TOTAL_CENTS);
  });

  it('is present in the rendered table model too', async () => {
    const result = await runReport(
      { ...TOP_5, presentation: { kind: 'table' } },
      { catalog, adapter: createMemoryDataSource({ sales: salesRows() }), copy: PT_BR_REPORT_ENGINE_COPY },
    );

    if (result.render.kind !== 'table') throw new Error('expected a table render');
    expect(result.render.rows.at(-1)?.product).toBe(OTHERS_BUCKET_LABEL);
  });
});
