import { describe, expect, it } from 'vitest';

import { ReportBuilderError } from '../../errors';
import {
  rangeFromQuery,
  REPORT_MAX_RANGE_DAYS,
  resolveReportRange,
  toReportRangeView,
} from '../range';

/**
 * The window a report runs over.
 *
 * These assertions are all about ONE thing: the window and the buckets inside
 * it have to be measured on the same clock. Every case below is stated on
 * `America/Sao_Paulo` (UTC-03:00), because that is where the two come apart —
 * on UTC the maths is trivially right and proves nothing.
 */
const SAO_PAULO = 'America/Sao_Paulo';

/** 20:00 in São Paulo on the 14th — mid-dinner, and already the 15th in UTC. */
const DINNER = new Date('2026-07-14T23:00:00Z');

describe('rolling presets are calendar days on the tenant’s clock', () => {
  it('“hoje” spans the tenant’s midnight-to-midnight, not UTC’s', () => {
    const range = resolveReportRange({ preset: 'today' }, DINNER, SAO_PAULO);

    // 00:00 on the 14th in São Paulo is 03:00Z; the window ends at the next.
    expect(range.from.toISOString()).toBe('2026-07-14T03:00:00.000Z');
    expect(range.toExclusive.toISOString()).toBe('2026-07-15T03:00:00.000Z');
  });

  it('would have put dinner in the WRONG day on a UTC window', () => {
    // The regression this guards, stated as the contrast: at 23:00Z the UTC
    // day has already rolled over, so a UTC "today" starts after the meal
    // being reported on and excludes it entirely.
    const utc = resolveReportRange({ preset: 'today' }, DINNER);

    expect(utc.from.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    expect(DINNER >= utc.from).toBe(true);
    // ...and on the tenant's clock the same instant is inside a window that
    // began three hours later, which is the point: the two disagree.
    const local = resolveReportRange({ preset: 'today' }, DINNER, SAO_PAULO);
    expect(local.from.getTime()).toBeGreaterThan(utc.from.getTime());
  });

  it('“7d” is today plus the six days before it, never six-and-a-bit', () => {
    const range = resolveReportRange({ preset: '7d' }, DINNER, SAO_PAULO);

    expect(range.from.toISOString()).toBe('2026-07-08T03:00:00.000Z');
    expect(range.toExclusive.toISOString()).toBe('2026-07-15T03:00:00.000Z');
    const days = (range.toExclusive.getTime() - range.from.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it('“30d” ends at the same next-midnight the shorter presets do', () => {
    const week = resolveReportRange({ preset: '7d' }, DINNER, SAO_PAULO);
    const month = resolveReportRange({ preset: '30d' }, DINNER, SAO_PAULO);

    expect(month.toExclusive.getTime()).toBe(week.toExclusive.getTime());
  });
});

/**
 * “Este mês” (FUT-755) — month-TO-DATE on the tenant's clock.
 *
 * Two distinct claims, and only the second is about time zones: that the window
 * opens on the FIRST of the month rather than a number of days back, and that
 * WHICH month that is is read on the merchant's clock. The zone cases are
 * stated at instants where UTC has already rolled into the next month and São
 * Paulo has not — anywhere else the two agree and the assertion would pass for
 * the wrong reason.
 */
describe('“este mês” is the calendar month to date', () => {
  it('opens on the 1st, not a number of days back', () => {
    const range = resolveReportRange({ preset: 'month' }, DINNER, SAO_PAULO);

    // 00:00 on 1 July in São Paulo is 03:00Z; the window still ends at the
    // next local midnight, so the partial current day is inside it.
    expect(range.from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    expect(range.toExclusive.toISOString()).toBe('2026-07-15T03:00:00.000Z');
  });

  it('is NOT the same window as “30d”', () => {
    // The whole reason the preset exists: on the 14th, "this month" is fourteen
    // days while "30 dias" reaches back into June. A resolver that treated
    // month as another day count would make the new pill a duplicate.
    const monthToDate = resolveReportRange({ preset: 'month' }, DINNER, SAO_PAULO);
    const thirty = resolveReportRange({ preset: '30d' }, DINNER, SAO_PAULO);

    expect(monthToDate.from.getTime()).toBeGreaterThan(thirty.from.getTime());
    expect(monthToDate.toExclusive.getTime()).toBe(thirty.toExclusive.getTime());
  });

  it('is one day long on the 1st', () => {
    // 21:00 in São Paulo on 1 August. Worth stating, because the window is at
    // its shortest exactly when a merchant is most likely to open the report
    // and doubt it.
    const firstOfMonth = new Date('2026-08-02T00:00:00Z');
    const range = resolveReportRange({ preset: 'month' }, firstOfMonth, SAO_PAULO);

    expect(range.from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(range.toExclusive.getTime() - range.from.getTime()).toBe(86_400_000);
  });

  it('reads WHICH month on the tenant’s clock, not on UTC’s', () => {
    // 21:30 on 31 July in São Paulo. In UTC it is already 1 August, so a month
    // resolved on UTC opens August's one-day window while the store is still
    // serving July's dinner — the whole month's figures gone from the screen
    // three hours early, on the one evening a merchant is closing the month.
    const lastNightOfJuly = new Date('2026-08-01T00:30:00Z');

    const local = resolveReportRange({ preset: 'month' }, lastNightOfJuly, SAO_PAULO);
    expect(local.from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    expect(lastNightOfJuly.getTime()).toBeGreaterThan(local.from.getTime());
    expect(lastNightOfJuly.getTime()).toBeLessThan(local.toExclusive.getTime());

    // …and the contrast that makes the assertion above mean something.
    const utc = resolveReportRange({ preset: 'month' }, lastNightOfJuly);
    expect(utc.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(utc.from.getTime()).toBeGreaterThan(local.from.getTime());
  });

  it('rolls into the new month only once the tenant’s clock does', () => {
    // 00:30 on 1 August in São Paulo (03:30Z) — the same boundary from the
    // other side: August IS the tenant's month now, and July's window is over.
    const firstMinutesOfAugust = new Date('2026-08-01T03:30:00Z');
    const range = resolveReportRange({ preset: 'month' }, firstMinutesOfAugust, SAO_PAULO);

    expect(range.from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });
});

describe('a custom range is inclusive at both ends', () => {
  it('runs to the END of the final day, not to its midnight', () => {
    const range = resolveReportRange(
      { preset: 'custom', from: '2026-07-01', to: '2026-07-31' },
      DINNER,
      SAO_PAULO,
    );

    expect(range.from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    // The 31st is INCLUDED, so the exclusive bound is the 1st of August.
    expect(range.toExclusive.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('accepts a single-day window', () => {
    const range = resolveReportRange(
      { preset: 'custom', from: '2026-07-14', to: '2026-07-14' },
      DINNER,
      SAO_PAULO,
    );

    expect(range.toExclusive.getTime() - range.from.getTime()).toBe(86_400_000);
  });
});

describe('an incoherent period is the caller’s mistake', () => {
  /**
   * All four fold to `ReportBuilderError`, which is what the routes turn into
   * a 400 — the same treatment a bad spec gets. A different error type here
   * would escape that fold and surface as a 500, turning the caller's typo
   * into our server fault.
   */
  it('rejects a custom range missing a bound', () => {
    expect(() => resolveReportRange({ preset: 'custom', from: '2026-07-01' }, DINNER)).toThrow(
      ReportBuilderError,
    );
  });

  it('rejects an inverted range', () => {
    expect(() =>
      resolveReportRange({ preset: 'custom', from: '2026-07-31', to: '2026-07-01' }, DINNER),
    ).toThrow(/posterior/);
  });

  it('rejects an unparseable bound', () => {
    expect(() =>
      resolveReportRange({ preset: 'custom', from: 'ontem', to: '2026-07-01' }, DINNER),
    ).toThrow(ReportBuilderError);
  });

  it(`rejects a window wider than ${REPORT_MAX_RANGE_DAYS} days`, () => {
    expect(() =>
      resolveReportRange({ preset: 'custom', from: '2024-01-01', to: '2026-01-01' }, DINNER),
    ).toThrow(new RegExp(String(REPORT_MAX_RANGE_DAYS)));
  });
});

describe('reading a period off a query string', () => {
  it('defaults to 30d when the caller named none', () => {
    expect(rangeFromQuery({})).toEqual({ preset: '30d' });
  });

  it('carries `month` through', () => {
    // A preset added to the list has to be readable off a query string too, or
    // the toggle sets a period the server quietly resolves as 30 dias.
    expect(rangeFromQuery({ preset: 'month' })).toEqual({ preset: 'month' });
  });

  it('ignores a preset that is not one of ours rather than failing', () => {
    // The builder's first load carries no query at all, and a stale bookmark
    // carries whatever it was saved with. Neither is worth a 400.
    expect(rangeFromQuery({ preset: 'ontem' })).toEqual({ preset: '30d' });
  });

  it('carries the custom bounds through', () => {
    expect(rangeFromQuery({ preset: 'custom', from: '2026-07-01', to: '2026-07-31' })).toEqual({
      preset: 'custom',
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });
});

describe('the wire view', () => {
  it('echoes the resolved instants, not the request’s words', () => {
    const range = resolveReportRange({ preset: 'today' }, DINNER, SAO_PAULO);

    expect(toReportRangeView(range)).toEqual({
      preset: 'today',
      from: '2026-07-14T03:00:00.000Z',
      toExclusive: '2026-07-15T03:00:00.000Z',
    });
  });
});
