import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { createMemoryDataSource, executeCompiledQuery } from '../memory';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { truncateDateToGrain } from '../time';
import { orderRows, salesCatalog } from './fixtures';

function run(input: ReportSpecInput) {
  const query = compileReport(reportSpecSchema.parse(input), salesCatalog);
  return executeCompiledQuery(orderRows, query);
}

describe('truncateDateToGrain', () => {
  it('truncates to UTC day', () => {
    expect(truncateDateToGrain('2026-07-01T23:59:59Z', 'day')).toBe('2026-07-01');
  });

  it('truncates to ISO week (Monday start)', () => {
    // 2026-07-01 is a Wednesday; its ISO week starts Monday 2026-06-29.
    expect(truncateDateToGrain('2026-07-01T10:00:00Z', 'week')).toBe('2026-06-29');
    expect(truncateDateToGrain('2026-07-08T12:00:00Z', 'week')).toBe('2026-07-06');
  });

  it('truncates to month', () => {
    expect(truncateDateToGrain('2026-07-31T00:00:00Z', 'month')).toBe('2026-07-01');
  });

  it('throws on invalid dates', () => {
    expect(() => truncateDateToGrain('not-a-date', 'day')).toThrow(/invalid date/i);
  });
});

describe('executeCompiledQuery', () => {
  it('groups by day buckets and sums money', () => {
    const rows = run({
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
      measures: [{ field: 'totalCents' }],
    });
    expect(rows).toEqual([
      { createdAt_day: '2026-07-01', sum_totalCents: 3000 },
      { createdAt_day: '2026-07-02', sum_totalCents: 3000 },
      { createdAt_day: '2026-07-08', sum_totalCents: 4000 },
      { createdAt_day: '2026-08-01', sum_totalCents: 5000 },
    ]);
  });

  it('groups by month and by categorical dimension', () => {
    const rows = run({
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'month' }, { field: 'method' }],
      measures: [{ field: 'totalCents' }, { field: 'id', aggregation: 'count', alias: 'orders' }],
    });
    expect(rows).toEqual([
      { createdAt_month: '2026-07-01', method: 'CARD', sum_totalCents: 2000, orders: 1 },
      { createdAt_month: '2026-07-01', method: 'PIX', sum_totalCents: 8000, orders: 3 },
      { createdAt_month: '2026-08-01', method: 'CARD', sum_totalCents: 5000, orders: 1 },
    ]);
  });

  it('applies eq/in/between filters before aggregation', () => {
    const rows = run({
      entity: 'orders',
      measures: [{ field: 'totalCents' }],
      filters: [
        { field: 'method', operator: 'eq', value: 'PIX' },
        { field: 'createdAt', operator: 'between', from: '2026-07-01', to: '2026-07-31T23:59:59Z' },
      ],
    });
    expect(rows).toEqual([{ sum_totalCents: 8000 }]);
  });

  it('supports avg, min, max and count_distinct', () => {
    const rows = run({
      entity: 'orders',
      measures: [
        { field: 'itemCount', aggregation: 'avg', alias: 'avgItems' },
        { field: 'totalCents', aggregation: 'min', alias: 'minTotal' },
        { field: 'totalCents', aggregation: 'max', alias: 'maxTotal' },
        { field: 'method', aggregation: 'count_distinct', alias: 'methods' },
      ],
    });
    expect(rows).toEqual([{ avgItems: 1.8, minTotal: 1000, maxTotal: 5000, methods: 2 }]);
  });

  it('sorts by measures and applies the limit', () => {
    const rows = run({
      entity: 'orders',
      dimensions: [{ field: 'method' }],
      measures: [{ field: 'totalCents' }],
      sort: [{ by: 'sum_totalCents', direction: 'desc' }],
      limit: 1,
    });
    expect(rows).toEqual([{ method: 'PIX', sum_totalCents: 8000 }]);
  });

  it('skips null values in aggregation and keys them as null buckets', () => {
    const query = compileReport(
      reportSpecSchema.parse({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
      }),
      salesCatalog,
    );
    const rows = executeCompiledQuery(
      [
        { method: null, totalCents: 100 },
        { method: 'PIX', totalCents: null },
        { method: 'PIX', totalCents: 200 },
      ],
      query,
    );
    expect(rows).toEqual([
      { method: null, sum_totalCents: 100 },
      { method: 'PIX', sum_totalCents: 200 },
    ]);
  });
});

describe('createMemoryDataSource', () => {
  it('resolves rows for the requested entity and empty for unknown tables', async () => {
    const adapter = createMemoryDataSource({ orders: orderRows });
    const query = compileReport(
      reportSpecSchema.parse({ entity: 'orders', measures: [{ field: 'totalCents' }] }),
      salesCatalog,
    );
    await expect(adapter.execute(query)).resolves.toEqual([{ sum_totalCents: 15000 }]);
  });
});
