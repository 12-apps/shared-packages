/**
 * The harness fixture's CLOCK, and the window a host applies to its rows.
 *
 * Its own module because every entity needs both and none of them owns them:
 * `report-orders-fixture` used to hold `NOW` because it was the only fixture
 * there was, so the kitchen and the stock ledger would have had to import
 * their clock from the sales data — which says something untrue about where a
 * clock belongs.
 *
 * The window filter is the HOST's job. `runOptions` hands the adapter factory
 * a resolved `{ from, toExclusive }` and the host is what decides which rows
 * that covers; the package never sees a row it was not given.
 */
import type { ReportWindow } from '@12-apps/report-builder/server';

/**
 * One fixture row — the plain shape the package's own in-memory executor folds
 * over. Deliberately flat: a report source row is columns, never a graph.
 */
export type FixtureRow = Record<string, string | number | boolean | null>;

/**
 * The clock every rolling preset resolves against, frozen. Against the REAL
 * clock every report would empty the moment July 2026 fell out of the last
 * thirty days — and, now that the window is honoured, the freeze also fixes
 * WHICH rows each preset returns: move it and "Hoje" stops meaning `o6`.
 *
 * 2026-07-05 09:00 in São Paulo. The kitchen fixtures are laid out against
 * that local time — a shift still open today has run from 05:30 to 09:00 and
 * no further — which is what makes their hours and their line counts agree.
 */
export const NOW = new Date('2026-07-05T12:00:00Z');

/**
 * The tenant's zone, and the one the fixture is authored in.
 *
 * It matters: `o3` is 02:00Z, which is 23:00 on the PREVIOUS local day. A
 * fixture laid out in UTC days silently disagrees with the buckets the server
 * computes, and the disagreement only shows up as an off-by-one row count.
 */
export const HARNESS_TIME_ZONE = 'America/Sao_Paulo';

/**
 * An instant written the way the merchant would say it: a local day and a
 * local time of day.
 *
 * The `-03:00` is spelled out rather than computed. São Paulo has had no DST
 * since 2019 and every date here is 2026, so the offset is a constant — and
 * one written into the literal is checkable by eye, where a subtraction from
 * UTC is the exact arithmetic this fixture keeps getting wrong.
 */
export function saoPauloInstant(day: string, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00-03:00`).toISOString();
}

/** The same instant shifted back by `seconds` — a start time from an end time. */
export function secondsBefore(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) - seconds * 1000).toISOString();
}

/**
 * The rows inside the window the server resolved, filtered on the entity's own
 * date field — the HOST's job, and the one this fixture used to skip.
 *
 * `toExclusive` is exclusive, as its name says: `<`, not `<=`. An inclusive
 * bound quietly pulls in the first row of the next day — exactly the off-by-one
 * a day-bucketed report is least able to show you.
 */
export function rowsInWindow(
  rows: readonly FixtureRow[],
  dateField: string,
  window: ReportWindow,
): FixtureRow[] {
  const from = window.from.getTime();
  const toExclusive = window.toExclusive.getTime();
  return rows.filter((row) => {
    const raw = row[dateField];
    if (typeof raw !== 'string') return false;
    const at = Date.parse(raw);
    return at >= from && at < toExclusive;
  });
}
