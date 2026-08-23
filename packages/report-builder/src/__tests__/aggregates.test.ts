import { describe, expect, it } from 'vitest';

import { percentileOf } from '../aggregates';
import { compileReport } from '../compile';
import { executeCompiledQuery } from '../memory';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { isSuppressed, SUPPRESSED } from '../types';
import { salesCatalog } from './fixtures';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';

type SourceRow = Record<string, unknown>;

function run(input: ReportSpecInput, rows: SourceRow[]) {
  return executeCompiledQuery(rows, compileReport(reportSpecSchema.parse(input), salesCatalog), PT_BR_REPORT_ENGINE_COPY.labels.othersBucket);
}

function compile(input: ReportSpecInput) {
  return compileReport(reportSpecSchema.parse(input), salesCatalog);
}

/** prepSeconds 1..10, one row each — the canonical percentile sample. */
const rankRows: SourceRow[] = Array.from({ length: 10 }, (_, index) => ({
  method: 'PIX',
  prepSeconds: index + 1,
}));

describe('percentileOf', () => {
  it('interpolates linearly between neighbours (R-7), never nearest-rank', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // rank = 0.9 * (10 - 1) = 8.1 → 9 + 0.1 * (10 - 9). Nearest-rank would say 9 or 10.
    expect(percentileOf(sorted, 0.9)).toBeCloseTo(9.1, 10);
    expect(percentileOf(sorted, 0.5)).toBeCloseTo(5.5, 10);
    expect(percentileOf(sorted, 0.95)).toBeCloseTo(9.55, 10);
  });

  it('returns the bounds at p0/p100 and the single value of a one-sample set', () => {
    expect(percentileOf([2, 4, 8], 0)).toBe(2);
    expect(percentileOf([2, 4, 8], 1)).toBe(8);
    expect(percentileOf([7], 0.9)).toBe(7);
  });

  it('returns null for an empty sample', () => {
    expect(percentileOf([], 0.9)).toBeNull();
  });
});

describe('percentile aggregations', () => {
  it('compiles p50/p90/p95 as first-class aggregations with derived aliases', () => {
    const query = compile({
      entity: 'orders',
      measures: [
        { field: 'prepSeconds', aggregation: 'p50' },
        { field: 'prepSeconds', aggregation: 'p90' },
        { field: 'prepSeconds', aggregation: 'p95' },
      ],
    });
    expect(query.measures.map((measure) => measure.alias)).toEqual([
      'p50_prepSeconds',
      'p90_prepSeconds',
      'p95_prepSeconds',
    ]);
  });

  it('executes a continuous p90 per group', () => {
    const rows = run(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90' }],
      },
      rankRows,
    );
    expect(rows).toEqual([{ method: 'PIX', p90: 9.1 }]);
  });

  it('ignores null samples and returns null when a group has none', () => {
    const rows = run(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90' }],
      },
      [
        { method: 'PIX', prepSeconds: null },
        { method: 'CARD', prepSeconds: 10 },
        { method: 'CARD', prepSeconds: null },
      ],
    );
    expect(rows).toEqual([
      { method: 'CARD', p90: 10 },
      { method: 'PIX', p90: null },
    ]);
  });

  it('rejects percentiles on non-numeric fields', () => {
    expect(() => compile({ entity: 'orders', measures: [{ field: 'method', aggregation: 'p90' }] })).toThrow(
      /not allowed/,
    );
  });
});

describe('ratio-of-sums aggregation', () => {
  it('divides the summed numerator by the summed denominator, not the per-row ratios', () => {
    const rows = run(
      {
        entity: 'orders',
        measures: [
          { field: 'lateItems', aggregation: 'ratio', denominator: 'itemCount', alias: 'lateRate' },
        ],
      },
      [
        { lateItems: 1, itemCount: 1 },
        { lateItems: 0, itemCount: 99 },
      ],
    );
    // sum(1, 0) / sum(1, 99) = 0.01. An average of per-row ratios would be 0.5.
    expect(rows).toEqual([{ lateRate: 0.01 }]);
  });

  it('returns null (not 0) when the denominator sums to zero', () => {
    const rows = run(
      {
        entity: 'orders',
        measures: [
          { field: 'lateItems', aggregation: 'ratio', denominator: 'itemCount', alias: 'lateRate' },
        ],
      },
      [{ lateItems: 5, itemCount: 0 }],
    );
    expect(rows).toEqual([{ lateRate: null }]);
  });

  it('skips rows without a denominator and treats a null numerator as zero', () => {
    const rows = run(
      {
        entity: 'orders',
        measures: [
          { field: 'lateItems', aggregation: 'ratio', denominator: 'itemCount', alias: 'lateRate' },
        ],
      },
      [
        { lateItems: 3, itemCount: null },
        { lateItems: null, itemCount: 4 },
        { lateItems: 1, itemCount: 4 },
      ],
    );
    expect(rows).toEqual([{ lateRate: 0.125 }]);
  });

  it('records the denominator on the compiled measure', () => {
    const query = compile({
      entity: 'orders',
      measures: [{ field: 'lateItems', aggregation: 'ratio', denominator: 'itemCount' }],
    });
    expect(query.measures[0]).toMatchObject({
      aggregation: 'ratio',
      denominatorField: 'itemCount',
      alias: 'ratio_lateItems',
    });
  });

  it('rejects a ratio without a denominator, and a denominator without a ratio', () => {
    expect(() =>
      compile({ entity: 'orders', measures: [{ field: 'lateItems', aggregation: 'ratio' }] }),
    ).toThrow(/requires "denominator"/);
    expect(() =>
      compile({ entity: 'orders', measures: [{ field: 'lateItems', denominator: 'itemCount' }] }),
    ).toThrow(/only valid on "ratio"/);
  });

  it('rejects a non-numeric denominator, naming the offending type', () => {
    expect(() =>
      compile({
        entity: 'orders',
        measures: [{ field: 'lateItems', aggregation: 'ratio', denominator: 'method' }],
      }),
    ).toThrow(/denominator.*number or money/i);
  });
});

describe('minSample suppression', () => {
  const spec = (minSample: number): ReportSpecInput => ({
    entity: 'orders',
    dimensions: [{ field: 'method' }],
    measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90', minSample }],
  });

  const sample: SourceRow[] = [
    { method: 'PIX', prepSeconds: 10 },
    { method: 'PIX', prepSeconds: 20 },
    { method: 'PIX', prepSeconds: 30 },
    { method: 'CARD', prepSeconds: 900 },
    { method: 'CARD', prepSeconds: 1000 },
  ];

  it('replaces the value with the suppressed marker below the threshold', () => {
    const rows = run(spec(3), sample);
    expect(rows).toEqual([
      { method: 'CARD', p90: SUPPRESSED },
      { method: 'PIX', p90: 28 },
    ]);
  });

  it('leaks neither the value nor the sample size in the suppressed row', () => {
    const [suppressed] = run(spec(3), sample);
    expect(suppressed && isSuppressed(suppressed.p90)).toBe(true);
    // Nothing else in the row may allow the reader to reconstruct either fact.
    expect(Object.keys(suppressed ?? {})).toEqual(['method', 'p90']);
    expect(JSON.stringify(suppressed)).not.toContain('900');
    expect(JSON.stringify(suppressed)).not.toContain('1000');
  });

  it('releases the value once the group reaches the threshold', () => {
    const rows = run(spec(2), sample);
    expect(rows).toEqual([
      { method: 'CARD', p90: 990 },
      { method: 'PIX', p90: 28 },
    ]);
  });

  it('counts only rows with a non-null value towards the sample', () => {
    const rows = run(spec(2), [
      { method: 'PIX', prepSeconds: 10 },
      { method: 'PIX', prepSeconds: null },
    ]);
    expect(rows).toEqual([{ method: 'PIX', p90: SUPPRESSED }]);
  });

  it('counts rows with a denominator as the ratio population', () => {
    const rows = run(
      {
        entity: 'orders',
        measures: [
          {
            field: 'lateItems',
            aggregation: 'ratio',
            denominator: 'itemCount',
            alias: 'lateRate',
            minSample: 2,
          },
        ],
      },
      [
        { lateItems: 1, itemCount: 4 },
        { lateItems: 1, itemCount: null },
      ],
    );
    expect(rows).toEqual([{ lateRate: SUPPRESSED }]);
  });

  it('sorts suppressed cells alongside nulls instead of by their hidden value', () => {
    const rows = run(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90', minSample: 3 }],
        sort: [{ by: 'p90', direction: 'desc' }],
      },
      sample,
    );
    // CARD hides the LARGER p90; ranking it first would leak that ordering.
    expect(rows.map((row) => row.method)).toEqual(['PIX', 'CARD']);
  });

  it('applies suppression per measure, leaving the others intact', () => {
    const rows = run(
      {
        entity: 'orders',
        measures: [
          { field: 'prepSeconds', aggregation: 'p90', alias: 'p90', minSample: 99 },
          { field: 'itemCount', aggregation: 'sum', alias: 'items' },
        ],
      },
      [{ prepSeconds: 10, itemCount: 2 }],
    );
    expect(rows).toEqual([{ p90: SUPPRESSED, items: 2 }]);
  });
});

describe('isSuppressed', () => {
  it('recognises only the marker', () => {
    expect(isSuppressed(SUPPRESSED)).toBe(true);
    expect(isSuppressed(null)).toBe(false);
    expect(isSuppressed(0)).toBe(false);
    expect(isSuppressed('suprimido')).toBe(false);
  });
});
