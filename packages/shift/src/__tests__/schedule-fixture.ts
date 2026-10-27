import { expect } from 'vitest';

import { ShiftScheduleError, createMemoryShiftScheduleDb, createShiftScheduleService } from '../index';
import type { ScheduleSeriesInput } from '../schedule-series-types';

/** A clinic's vocabulary — nurses on a `ward` or a `triage` shift — on purpose not this package's. */
export const KINDS = ['ward', 'triage'] as const;
const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A Tuesday, 09:00 in São Paulo (no daylight saving since 2019). */
export const NOW = new Date('2026-10-20T12:00:00.000Z');
export const SP = 'America/Sao_Paulo';
/** Leaves daylight time on 2026-11-01. */
export const NY = 'America/New_York';

export const BASE = { clientId: 'clinic-a', userId: 'nurse-1', kind: 'ward' as const, actorUserId: 'head-1' };

export function setup(options: { horizonWeeks?: number } = {}) {
  const clock = { now: NOW };
  const ids = { n: 0 };
  const db = createMemoryShiftScheduleDb();
  const schedule = createShiftScheduleService(db, {
    kinds: KINDS,
    now: () => clock.now,
    createId: () => `id-${String(++ids.n).padStart(4, '0')}`,
    ...options,
  });
  const live = () => db.slots().filter((slot) => slot.canceledAt === null);
  /** Move the service's clock. */
  const setNow = (now: Date): void => {
    clock.now = now;
  };
  return { db, schedule, setNow, live };
}

/** Mondays and Wednesdays, 10:00–14:00 in São Paulo, from tomorrow, with no end. */
export function weekly(overrides: Partial<ScheduleSeriesInput<(typeof KINDS)[number]>> = {}): ScheduleSeriesInput<
  (typeof KINDS)[number]
> {
  return {
    ...BASE,
    weekdays: [1, 3],
    everyWeeks: 1,
    startMinutes: 10 * 60,
    endMinutes: 14 * 60,
    timeZone: SP,
    startsOn: '2026-10-21',
    ...overrides,
  };
}

export function iso(dates: readonly Date[]): string[] {
  return dates.map((date) => date.toISOString());
}

/** The local day each slot starts on, in São Paulo (UTC−3). */
export function spDays(slots: readonly { startsAt: Date }[]): string[] {
  return slots.map((slot) => new Date(slot.startsAt.getTime() - 3 * HOUR_MS).toISOString().slice(0, 10)).sort();
}

export async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ShiftScheduleError);
  return (error as ShiftScheduleError).code;
}
