import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { executeCompiledQuery } from '../memory';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { DEFAULT_REPORT_TIME_ZONE, truncateDateToGrain } from '../time';
import { salesCatalog } from './fixtures';

type SourceRow = Record<string, unknown>;

function run(input: ReportSpecInput, rows: SourceRow[]) {
  return executeCompiledQuery(rows, compileReport(reportSpecSchema.parse(input), salesCatalog));
}

/** 02:00Z on the 31st is still the 30th at 23:00 in São Paulo (UTC-3). */
const LATE_NIGHT = '2026-07-31T02:00:00Z';

describe('truncateDateToGrain', () => {
  it('still truncates in UTC when no zone is given (the documented default)', () => {
    expect(truncateDateToGrain(LATE_NIGHT, 'day')).toBe('2026-07-31');
    expect(truncateDateToGrain('2026-07-01T23:59:59Z', 'day')).toBe('2026-07-01');
  });

  it('buckets the day on the tenant clock', () => {
    expect(truncateDateToGrain(LATE_NIGHT, 'day', DEFAULT_REPORT_TIME_ZONE)).toBe('2026-07-30');
    expect(truncateDateToGrain(LATE_NIGHT, 'day', 'UTC')).toBe('2026-07-31');
    expect(truncateDateToGrain(LATE_NIGHT, 'day', 'Asia/Tokyo')).toBe('2026-07-31');
  });

  it('buckets the month on the tenant clock', () => {
    // 01/08 02:00Z is 31/07 23:00 in São Paulo — July, not August.
    expect(truncateDateToGrain('2026-08-01T02:00:00Z', 'month', DEFAULT_REPORT_TIME_ZONE)).toBe(
      '2026-07-01',
    );
    expect(truncateDateToGrain('2026-08-01T02:00:00Z', 'month', 'UTC')).toBe('2026-08-01');
  });

  it('buckets the ISO week (Monday start) on the tenant clock', () => {
    // Monday 06/07 02:00Z is Sunday 05/07 in São Paulo → the PREVIOUS ISO week.
    expect(truncateDateToGrain('2026-07-06T02:00:00Z', 'week', DEFAULT_REPORT_TIME_ZONE)).toBe(
      '2026-06-29',
    );
    expect(truncateDateToGrain('2026-07-06T02:00:00Z', 'week', 'UTC')).toBe('2026-07-06');
  });

  it('handles a Date instance and an epoch millisecond value alike', () => {
    const instant = new Date(LATE_NIGHT);
    expect(truncateDateToGrain(instant, 'day', DEFAULT_REPORT_TIME_ZONE)).toBe('2026-07-30');
    expect(truncateDateToGrain(instant.getTime(), 'day', DEFAULT_REPORT_TIME_ZONE)).toBe(
      '2026-07-30',
    );
  });

  it('throws on invalid dates', () => {
    expect(() => truncateDateToGrain('not-a-date', 'day')).toThrow(/invalid date/i);
  });
});

describe('tenant-local date buckets', () => {
  const rows: SourceRow[] = [
    { createdAt: LATE_NIGHT, totalCents: 1000 },
    { createdAt: '2026-07-30T15:00:00Z', totalCents: 2000 },
  ];

  it('defaults to America/Sao_Paulo, so a late-night sale lands on the local day', () => {
    expect(
      run(
        {
          entity: 'orders',
          dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
          measures: [{ field: 'totalCents' }],
        },
        rows,
      ),
    ).toEqual([{ createdAt_day: '2026-07-30', sum_totalCents: 3000 }]);
  });

  it('honours a spec-level IANA time zone', () => {
    expect(
      run(
        {
          entity: 'orders',
          timeZone: 'UTC',
          dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
          measures: [{ field: 'totalCents' }],
        },
        rows,
      ),
    ).toEqual([
      { createdAt_day: '2026-07-30', sum_totalCents: 2000 },
      { createdAt_day: '2026-07-31', sum_totalCents: 1000 },
    ]);
  });

  it('resolves the zone onto the compiled query so adapters see it', () => {
    const spec = { entity: 'orders', measures: [{ field: 'totalCents' }] } as const;
    expect(compileReport(reportSpecSchema.parse(spec), salesCatalog).timeZone).toBe(
      DEFAULT_REPORT_TIME_ZONE,
    );
    expect(
      compileReport(reportSpecSchema.parse(spec), salesCatalog, { timeZone: 'America/Manaus' })
        .timeZone,
    ).toBe('America/Manaus');
    expect(
      compileReport(reportSpecSchema.parse({ ...spec, timeZone: 'UTC' }), salesCatalog, {
        timeZone: 'America/Manaus',
      }).timeZone,
    ).toBe('UTC');
  });

  it('rejects an unknown time zone with an actionable message', () => {
    expect(() =>
      compileReport(
        reportSpecSchema.parse({
          entity: 'orders',
          timeZone: 'Mars/Olympus',
          measures: [{ field: 'totalCents' }],
        }),
        salesCatalog,
      ),
    ).toThrow(/Unknown time zone "Mars\/Olympus"/);
  });
});
