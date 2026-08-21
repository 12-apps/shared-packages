import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { ReportBuilderError } from '../errors';
import { createMemoryDataSource } from '../memory';
import { runReport } from '../run';
import { orderRows, salesCatalog } from './fixtures';

const options = {
  catalog: salesCatalog,
  adapter: createMemoryDataSource({ orders: orderRows }),
  copy: PT_BR_REPORT_ENGINE_COPY,
};

describe('runReport', () => {
  it('runs a table report end to end with labeled, formatted columns', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }, { field: 'id', aggregation: 'count', alias: 'orders' }],
      },
      options,
    );
    expect(result.render.kind).toBe('table');
    if (result.render.kind === 'table') {
      expect(result.render.columns).toEqual([
        { key: 'method', label: 'Forma de pagamento', format: 'text' },
        { key: 'sum_totalCents', label: 'Receita', format: 'brl' },
        { key: 'orders', label: 'Pedido (contagem)', format: 'integer' },
      ]);
      expect(result.render.rows).toHaveLength(2);
    }
  });

  it('renders a KPI tile: whole-period figure, labeled and formatted (FUT-309)', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'kpi' },
      },
      options,
    );
    expect(result.render).toMatchObject({
      kind: 'kpi',
      label: 'Receita',
      value: 15_000,
      format: 'brl',
    });
  });

  it('renders a KPI over an empty period with a null value, honoring overrides', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        measures: [{ field: 'totalCents' }],
        filters: [{ field: 'method', operator: 'eq', value: 'BOLETO' }],
        presentation: { kind: 'kpi', label: 'Receita liquidada', numberFormat: 'compact' },
      },
      options,
    );
    expect(result.render).toMatchObject({
      kind: 'kpi',
      label: 'Receita liquidada',
      value: null,
      format: 'compact',
    });
  });

  it('renders chart presentations as a @12-apps/ui ChartSpec', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'totalCents', alias: 'revenue' }],
        presentation: { kind: 'chart', chartType: 'area' },
      },
      options,
    );
    expect(result.render.kind).toBe('chart');
    if (result.render.kind === 'chart') {
      expect(result.render.chartSpec).toMatchObject({
        type: 'area',
        xAxis: { key: 'createdAt_day' },
        series: [{ key: 'revenue', label: 'Receita' }],
        numberFormat: 'brl',
      });
      // The whole render model must survive JSON serialization (persistence + MCP).
      expect(JSON.parse(JSON.stringify(result.render)).chartSpec.type).toBe('area');
    }
  });

  /**
   * FUT-391 CHANGED the assertion above: the x axis used to carry
   * `label: 'Data (dia)'`. Its removal is deliberate — the title rendered ON
   * TOP of the tick labels, and the block's spec sentence now states what the
   * axis is. These two cases make the removal a stated guarantee rather than a
   * detail someone re-adds while fixing something else.
   */
  it('emits no axis title — the spec sentence says what the axis is', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'chart', chartType: 'bar' },
      },
      options,
    );

    if (result.render.kind !== 'chart') throw new Error('expected a chart render');
    expect(result.render.chartSpec.xAxis.label).toBeUndefined();
    // The SERIES keeps its label — that one names the measure, and a legend of
    // unnamed series is unreadable.
    expect(result.render.chartSpec.series[0]?.label).toBe('Receita');
  });

  it('never smooths a line, whatever the point count', async () => {
    // A curve between two points draws through values nobody measured, and two
    // points is exactly what a short period produces.
    for (const chartType of ['line', 'area'] as const) {
      const result = await runReport(
        {
          entity: 'orders',
          dimensions: [{ field: 'createdAt', timeGrain: 'month' }],
          measures: [{ field: 'totalCents' }],
          presentation: { kind: 'chart', chartType },
        },
        options,
      );

      if (result.render.kind !== 'chart') throw new Error('expected a chart render');
      expect(result.render.chartSpec.curved).toBe(false);
    }
  });

  it('rejects invalid specs with actionable messages', async () => {
    await expect(runReport({ entity: 'orders', measures: [] }, options)).rejects.toThrow(
      ReportBuilderError,
    );
    await expect(runReport({ entity: 'nope', measures: [{ field: 'x' }] }, options)).rejects.toThrow(
      /Available entities/,
    );
  });

  it('caps returned rows at the host maxRows', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'totalCents' }],
      },
      { ...options, maxRows: 2 },
    );
    expect(result.rows).toHaveLength(2);
    expect(result.query.limit).toBe(2);
  });
});
