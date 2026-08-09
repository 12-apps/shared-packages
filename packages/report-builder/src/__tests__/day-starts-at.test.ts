import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { createMemoryDataSource, executeCompiledQuery } from '../memory';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { truncateDateToGrain } from '../time';
import { salesCatalog } from './fixtures';

/**
 * Plan entry 5's outstanding half: a trading day that does not end at midnight
 * (FUT-755).
 *
 * A bar closing at 02:00 wants Tuesday's takings to include Wednesday
 * 00:00-02:00. With the civil day as the only day that revenue lands on
 * Wednesday, and both days read wrong — one short, the next inexplicably busy
 * before opening.
 *
 * The zone here is `America/Sao_Paulo` (UTC-3), so the instants below are
 * written in UTC and the local hour is stated in each case.
 */

const SP = 'America/Sao_Paulo';

describe('truncateDateToGrain — dayStartsAt', () => {
  it('leaves the civil day alone when the day starts at midnight', () => {
    // 01:00 local on the 2nd.
    expect(truncateDateToGrain('2026-07-02T04:00:00Z', 'day', SP)).toBe('2026-07-02');
  });

  it('puts an hour before the boundary on the previous day', () => {
    // The acceptance criterion, verbatim: with dayStartsAt=05:00, a 01:00 order
    // belongs to the previous day.
    expect(truncateDateToGrain('2026-07-02T04:00:00Z', 'day', SP, 5)).toBe('2026-07-01');
  });

  it('leaves an hour at or after the boundary on its own day', () => {
    // 05:00 local on the 2nd — the boundary itself opens the new day.
    expect(truncateDateToGrain('2026-07-02T08:00:00Z', 'day', SP, 5)).toBe('2026-07-02');
    // 23:30 local on the 2nd stays on the 2nd, which is the half that already
    // passed and must keep passing.
    expect(truncateDateToGrain('2026-07-03T02:30:00Z', 'day', SP, 5)).toBe('2026-07-02');
  });

  it('carries the shift across a month edge', () => {
    // 01:00 local on 1 August belongs to 31 July's trading day. Done before the
    // month truncation, so the month bucket moves too.
    expect(truncateDateToGrain('2026-08-01T04:00:00Z', 'day', SP, 5)).toBe('2026-07-31');
    expect(truncateDateToGrain('2026-08-01T04:00:00Z', 'month', SP, 5)).toBe('2026-07-01');
  });

  it('carries the shift across an ISO week edge', () => {
    // 2026-07-06 is a Monday. 01:00 local belongs to Sunday the 5th, whose ISO
    // week starts Monday the 29th of June.
    expect(truncateDateToGrain('2026-07-06T04:00:00Z', 'week', SP, 5)).toBe('2026-06-29');
    expect(truncateDateToGrain('2026-07-06T04:00:00Z', 'week', SP)).toBe('2026-07-06');
  });

  it('treats midnight as hour 0, not hour 24', () => {
    // `hour12: false` renders midnight as 24 on some runtimes, which would push
    // every 00:00 event a day early even with the boundary at midnight.
    expect(truncateDateToGrain('2026-07-02T03:00:00Z', 'day', SP)).toBe('2026-07-02');
    expect(truncateDateToGrain('2026-07-02T03:00:00Z', 'day', SP, 5)).toBe('2026-07-01');
  });

  it('rejects a boundary that is not a whole hour of the day', () => {
    for (const bad of [-1, 24, 5.5]) {
      expect(() => truncateDateToGrain('2026-07-02T04:00:00Z', 'day', SP, bad)).toThrow(
        /"dayStartsAt" must be a whole hour 0-23/,
      );
    }
  });
});

/**
 * The pure function above is only half the claim. The acceptance is about an
 * ORDER landing in a bucket, so these run rows through compile + execute — the
 * path a real report takes — rather than trusting that the boundary is plumbed.
 */
describe('dayStartsAt end to end', () => {
  /** One sale at 01:00 local on 2 July, and one at 20:00 local on 1 July. */
  const ROWS = [
    { id: 'late', createdAt: '2026-07-02T04:00:00Z', method: 'PIX', totalCents: 1000, itemCount: 1 },
    { id: 'evening', createdAt: '2026-07-01T23:00:00Z', method: 'PIX', totalCents: 500, itemCount: 1 },
  ];

  const SPEC: ReportSpecInput = {
    entity: 'orders',
    timeZone: SP,
    dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
    measures: [{ field: 'totalCents' }],
  };

  const bucketsFor = (input: ReportSpecInput) =>
    executeCompiledQuery(ROWS, compileReport(reportSpecSchema.parse(input), salesCatalog));

  it('splits the night across two days when the day starts at midnight', () => {
    // 20:00 on the 1st and 01:00 on the 2nd are different civil days.
    expect(bucketsFor(SPEC)).toEqual([
      { createdAt_day: '2026-07-01', sum_totalCents: 500 },
      { createdAt_day: '2026-07-02', sum_totalCents: 1000 },
    ]);
  });

  it('keeps one night on one date when the day starts at 05:00', () => {
    // Both sales belong to 1 July's trading day, so they sum into ONE bucket —
    // which is the whole point: the totals move, not just the labels.
    expect(bucketsFor({ ...SPEC, dayStartsAt: 5 })).toEqual([
      { createdAt_day: '2026-07-01', sum_totalCents: 1500 },
    ]);
  });

  it('takes the boundary from the host when the spec omits it', () => {
    const query = compileReport(reportSpecSchema.parse(SPEC), salesCatalog, { dayStartsAt: 5 });
    expect(query.dayStartsAt).toBe(5);
    expect(executeCompiledQuery(ROWS, query)).toHaveLength(1);
  });

  it('lets the spec override the host', () => {
    const query = compileReport(reportSpecSchema.parse({ ...SPEC, dayStartsAt: 0 }), salesCatalog, {
      dayStartsAt: 5,
    });
    expect(query.dayStartsAt).toBe(0);
    expect(executeCompiledQuery(ROWS, query)).toHaveLength(2);
  });

  it('rejects a boundary outside 0-23 at the schema edge', () => {
    expect(() => reportSpecSchema.parse({ ...SPEC, dayStartsAt: 24 })).toThrow();
    expect(() => reportSpecSchema.parse({ ...SPEC, dayStartsAt: 5.5 })).toThrow();
  });

  it('is reachable through the packaged data source', async () => {
    // `createMemoryDataSource` is what a host without SQL runs on; the boundary
    // must survive that path too, not only a direct `executeCompiledQuery`.
    const source = createMemoryDataSource({ orders: ROWS });
    const query = compileReport(reportSpecSchema.parse({ ...SPEC, dayStartsAt: 5 }), salesCatalog);
    await expect(source.execute(query)).resolves.toHaveLength(1);
  });
});
