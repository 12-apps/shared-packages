/**
 * The harness fixture's ORDERS, and the window filter a host applies to them.
 *
 * Its own module because `memory-backend` is at the size gate's ceiling and
 * this is the half of it that is DATA: which rows exist, when they happened,
 * and which of them a resolved window contains. The wiring — the catalog, the
 * store, the actor, the router — stays there.
 */
import type { ReportWindow } from '@12-apps/report-builder/server';

/**
 * The fixture's orders, laid out so every preset VISIBLY differs.
 *
 * `NOW` is 2026-07-05 09:00 in São Paulo, so the local days are: `o6` today,
 * `o1`–`o5` across the four days before it, `o8` on the last day of JUNE, and
 * `o7` a fortnight back. Counted as day buckets, each preset therefore returns
 * a different number — the only arrangement in which the toggle can be seen to
 * work at all:
 *
 *   hoje 1  ⊂  este mês 4  ⊂  7 dias 5  ⊂  30 dias 6
 *
 * `o8` is what makes `Este mês` distinguishable (FUT-755). Without it the
 * month-to-date window and `7 dias` cover the same four days, so the new pill
 * could resolve to either and this fixture could not tell them apart. Note the
 * ORDER too: month-to-date is NARROWER than seven days for the first week of
 * every month, which is why `Este mês` is not a rung on the empty state's
 * widening ladder.
 *
 * The zone matters: `o3` is 02:00Z, which is 23:00 on the PREVIOUS local day.
 * A fixture laid out in UTC days silently disagrees with the buckets.
 */
export const ROWS = [
  { id: 'o7', createdAt: '2026-06-20T15:00:00Z', method: 'CARD', status: 'PAID', revenueCents: 900, itemCount: 1 },
  // 30 June, 12:00 in São Paulo — inside "7 dias", outside "Este mês".
  { id: 'o8', createdAt: '2026-06-30T15:00:00Z', method: 'PIX', status: 'PAID', revenueCents: 1700, itemCount: 2 },
  { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', status: 'PAID', revenueCents: 1000, itemCount: 1 },
  { id: 'o2', createdAt: '2026-07-01T14:00:00Z', method: 'CARD', status: 'PAID', revenueCents: 2500, itemCount: 3 },
  { id: 'o3', createdAt: '2026-07-02T02:00:00Z', method: 'PIX', status: 'PAID', revenueCents: 3000, itemCount: 2 },
  { id: 'o4', createdAt: '2026-07-03T09:00:00Z', method: 'WAITER', status: 'FAILED', revenueCents: 800, itemCount: 1 },
  { id: 'o5', createdAt: '2026-07-04T20:00:00Z', method: 'CARD', status: 'PAID', revenueCents: 4200, itemCount: 4 },
  { id: 'o6', createdAt: '2026-07-05T13:00:00Z', method: 'PIX', status: 'PAID', revenueCents: 1500, itemCount: 2 },
];

/**
 * The clock every rolling preset resolves against, frozen. Against the REAL
 * clock every report would empty the moment July 2026 fell out of the last
 * thirty days — and, now that the window is honoured (`rowsInWindow`), the
 * freeze also fixes WHICH rows each preset returns: move it and "Hoje" stops
 * meaning `o6`.
 */
export const NOW = new Date('2026-07-05T12:00:00Z');

/**
 * The rows inside the window the server resolved — the HOST's job, and the one
 * this fixture used to skip. `runOptions` hands the adapter factory a
 * `{ from, toExclusive }`; this one ignored it and returned every row for every
 * preset, so the period toggle had never done anything here, and `defaultRange`
 * and the resolved-window line were unverifiable with it.
 *
 * `toExclusive` is exclusive, as its name says: `<`, not `<=`. An inclusive
 * bound quietly pulls in the first row of the next day — exactly the off-by-one
 * a day-bucketed report is least able to show you.
 */
export function rowsInWindow(window: ReportWindow): typeof ROWS {
  const from = window.from.getTime();
  const toExclusive = window.toExclusive.getTime();
  return ROWS.filter((row) => {
    const at = Date.parse(row.createdAt);
    return at >= from && at < toExclusive;
  });
}
