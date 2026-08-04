import { describe, expect, it } from 'vitest';

import { compileReport, DEFAULT_ROW_LIMIT } from '../compile';
import { ReportBuilderError } from '../errors';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { salesCatalog } from './fixtures';

function compile(input: ReportSpecInput, maxRows?: number) {
  return compileReport(reportSpecSchema.parse(input), salesCatalog, { maxRows });
}

describe('compileReport', () => {
  it('rejects KPI presentations with dimensions or multiple measures (FUT-309)', () => {
    expect(() =>
      compile({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'kpi' },
      }),
    ).toThrow(/KPI presentation aggregates the whole period/);
    expect(() =>
      compile({
        entity: 'orders',
        measures: [{ field: 'totalCents' }, { field: 'itemCount' }],
        presentation: { kind: 'kpi' },
      }),
    ).toThrow(/exactly 1 measure/);
    expect(() =>
      compile({
        entity: 'orders',
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'kpi', label: 'Receita' },
      }),
    ).not.toThrow();
  });


  it('lowers a spec to the query IR with derived aliases and defaults', () => {
    const query = compile({
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'month' }],
      measures: [{ field: 'totalCents' }, { field: 'id', aggregation: 'count_distinct', alias: 'orders' }],
      sort: [{ by: 'sum_totalCents', direction: 'desc' }],
    });
    expect(query).toMatchObject({
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'month', alias: 'createdAt_month' }],
      measures: [
        { field: 'totalCents', aggregation: 'sum', alias: 'sum_totalCents' },
        { field: 'id', aggregation: 'count_distinct', alias: 'orders' },
      ],
      sort: [{ alias: 'sum_totalCents', direction: 'desc' }],
      limit: DEFAULT_ROW_LIMIT,
    });
  });

  it('defaults date dimensions to day grain', () => {
    const query = compile({
      entity: 'orders',
      dimensions: [{ field: 'createdAt' }],
      measures: [{ field: 'totalCents' }],
    });
    expect(query.dimensions[0]).toMatchObject({ timeGrain: 'day', alias: 'createdAt_day' });
  });

  it('rejects unknown entities listing the available ones', () => {
    expect(() => compile({ entity: 'invoices', measures: [{ field: 'totalCents' }] })).toThrow(
      /Unknown entity "invoices".*orders/,
    );
  });

  it('rejects unknown fields listing the available ones', () => {
    expect(() =>
      compile({ entity: 'orders', measures: [{ field: 'revenue' }] }),
    ).toThrow(/Unknown field "revenue".*totalCents/);
  });

  it('rejects measures used as dimensions', () => {
    expect(() =>
      compile({ entity: 'orders', dimensions: [{ field: 'totalCents' }], measures: [{ field: 'itemCount' }] }),
    ).toThrow(ReportBuilderError);
  });

  it('rejects timeGrain on non-date dimensions', () => {
    expect(() =>
      compile({
        entity: 'orders',
        dimensions: [{ field: 'method', timeGrain: 'day' }],
        measures: [{ field: 'totalCents' }],
      }),
    ).toThrow(/timeGrain/);
  });

  it('rejects disallowed aggregations with the allowed list', () => {
    expect(() =>
      compile({ entity: 'orders', measures: [{ field: 'method', aggregation: 'sum' }] }),
    ).toThrow(/not allowed.*count/);
  });

  it('rejects duplicate output aliases', () => {
    expect(() =>
      compile({
        entity: 'orders',
        measures: [{ field: 'totalCents', alias: 'x' }, { field: 'itemCount', alias: 'x' }],
      }),
    ).toThrow(/Duplicate output column "x"/);
  });

  it('rejects sorting by a non-output column', () => {
    expect(() =>
      compile({ entity: 'orders', measures: [{ field: 'totalCents' }], sort: [{ by: 'nope', direction: 'asc' }] }),
    ).toThrow(/not an output column/);
  });

  it('requires exactly one dimension for chart presentations', () => {
    expect(() =>
      compile({
        entity: 'orders',
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'chart', chartType: 'line' },
      }),
    ).toThrow(/exactly 1 dimension/);
  });

  it('requires a single measure for pie charts', () => {
    expect(() =>
      compile({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }, { field: 'itemCount' }],
        presentation: { kind: 'chart', chartType: 'pie' },
      }),
    ).toThrow(/exactly 1 measure/);
  });

  it('clamps the limit to the host cap', () => {
    expect(compile({ entity: 'orders', measures: [{ field: 'totalCents' }], limit: 5000 }, 200).limit).toBe(200);
    expect(compile({ entity: 'orders', measures: [{ field: 'totalCents' }], limit: 50 }, 200).limit).toBe(50);
  });
});
