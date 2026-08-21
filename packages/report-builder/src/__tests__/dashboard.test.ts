import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { ReportBuilderError } from '../errors';
import { createMemoryDataSource } from '../memory';
import { parseReportDocument, runDashboard } from '../run';
import { documentEntities, isDashboardSpec } from '../spec';
import { orderRows, salesCatalog } from './fixtures';

const options = {
  catalog: salesCatalog,
  adapter: createMemoryDataSource({ orders: orderRows }),
  copy: PT_BR_REPORT_ENGINE_COPY,
};

const revenueByMethod = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
};

describe('parseReportDocument', () => {
  it('parses a single spec exactly like parseReportSpec', () => {
    const doc = parseReportDocument(revenueByMethod);
    expect(isDashboardSpec(doc)).toBe(false);
    expect(documentEntities(doc)).toEqual(['orders']);
  });

  it('parses a dashboard document and defaults block spans', () => {
    const doc = parseReportDocument({
      kind: 'dashboard',
      blocks: [
        { id: 'a', spec: revenueByMethod },
        { id: 'b', title: 'Receita', span: 12, spec: revenueByMethod },
      ],
    });
    if (!isDashboardSpec(doc)) throw new Error('expected a dashboard');
    expect(doc.blocks.map((block) => block.span)).toEqual([6, 12]);
    expect(documentEntities(doc)).toEqual(['orders']);
  });

  it('rejects duplicate block ids with an actionable message', () => {
    expect(() =>
      parseReportDocument({
        kind: 'dashboard',
        blocks: [
          { id: 'a', spec: revenueByMethod },
          { id: 'a', spec: revenueByMethod },
        ],
      }),
    ).toThrow(/Duplicate block id "a"/);
  });

  it('reports dashboard-branch issues only, with block paths', () => {
    expect(() =>
      parseReportDocument({ kind: 'dashboard', blocks: [{ id: 'a', spec: { entity: 'orders' } }] }),
    ).toThrow(/blocks\.0\.spec\.measures/);
    expect(() => parseReportDocument({ kind: 'dashboard', blocks: [] })).toThrow(ReportBuilderError);
  });
});

describe('runDashboard', () => {
  it('runs every block and keys results by block id', async () => {
    const result = await runDashboard(
      {
        kind: 'dashboard',
        blocks: [
          { id: 'tabela', spec: revenueByMethod },
          {
            id: 'grafico',
            title: 'Receita por dia',
            span: 12,
            spec: {
              ...revenueByMethod,
              dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
              presentation: { kind: 'chart', chartType: 'line' },
            },
          },
        ],
      },
      options,
    );
    expect(result.blocks.map((block) => block.id)).toEqual(['tabela', 'grafico']);
    const [table, chart] = result.blocks;
    expect(table?.status).toBe('ok');
    expect(chart?.status).toBe('ok');
    if (chart?.status === 'ok') {
      expect(chart.render.kind).toBe('chart');
      expect(chart.title).toBe('Receita por dia');
      expect(chart.span).toBe(12);
    }
  });

  it('degrades a stale block to an inline error while the rest render', async () => {
    const result = await runDashboard(
      {
        kind: 'dashboard',
        blocks: [
          { id: 'ok', spec: revenueByMethod },
          { id: 'stale', spec: { ...revenueByMethod, measures: [{ field: 'gone' }] } },
        ],
      },
      options,
    );
    const [ok, stale] = result.blocks;
    expect(ok?.status).toBe('ok');
    expect(stale?.status).toBe('error');
    if (stale?.status === 'error') {
      expect(stale.error).toMatch(/Unknown field "gone"/);
    }
  });

  it('rejects the whole run on infrastructure failures', async () => {
    const broken = {
      catalog: salesCatalog,
      adapter: {
        execute: () => Promise.reject(new Error('connection lost')),
      },
      copy: PT_BR_REPORT_ENGINE_COPY,
    };
    await expect(
      runDashboard({ kind: 'dashboard', blocks: [{ id: 'a', spec: revenueByMethod }] }, broken),
    ).rejects.toThrow('connection lost');
  });

  it('rejects a single spec handed to the dashboard runner', async () => {
    await expect(runDashboard(revenueByMethod, options)).rejects.toThrow(/kind: "dashboard"/);
  });
});
