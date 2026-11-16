import { describe, expect, it } from 'vitest';

import { readSchedule, reportScheduleDraftInput, resolveSchedule } from '../schedule';
import { saveReportBody } from '../wire';

const base = {
  name: 'Vendas',
  spec: { entity: 'orders', measures: [{ field: 'revenueCents', aggregation: 'sum' as const }] },
};
const weekly = {
  enabled: true,
  cadence: 'weekly' as const,
  weekday: 1,
  time: '08:00',
  recipients: ['u1'],
};
const clock = { timeZone: 'America/Sao_Paulo', now: new Date('2026-11-16T15:00:00Z') };

describe('the schedule on the save body (FUT-776)', () => {
  it('is optional: omitted keeps, null removes', () => {
    expect(saveReportBody.parse(base).schedule).toBeUndefined();
    expect(saveReportBody.parse({ ...base, schedule: null }).schedule).toBeNull();
  });

  it('accepts each cadence with the day it needs', () => {
    for (const schedule of [
      { ...weekly, cadence: 'daily' },
      weekly,
      { ...weekly, cadence: 'biweekly' },
      { ...weekly, cadence: 'monthly', weekday: undefined, dayOfMonth: 31 },
    ]) {
      expect(saveReportBody.safeParse({ ...base, schedule }).success).toBe(true);
    }
  });

  it('refuses a cadence without its day, a bad time, and a zone or anchor from the client', () => {
    const refuse = (schedule: object): boolean =>
      saveReportBody.safeParse({ ...base, schedule }).success;
    expect(refuse({ ...weekly, weekday: undefined })).toBe(false);
    expect(refuse({ ...weekly, cadence: 'monthly', weekday: undefined })).toBe(false);
    expect(refuse({ ...weekly, time: '8:00' })).toBe(false);
    expect(refuse({ ...weekly, weekday: 7 })).toBe(false);
    expect(refuse({ ...weekly, timeZone: 'UTC' })).toBe(false);
    expect(refuse({ ...weekly, startsOn: '2026-01-01' })).toBe(false);
  });

  it('refuses an enabled schedule with nobody to send to, but a disabled one may be empty', () => {
    expect(saveReportBody.safeParse({ ...base, schedule: { ...weekly, recipients: [] } }).success).toBe(false);
    expect(
      saveReportBody.safeParse({ ...base, schedule: { ...weekly, enabled: false, recipients: [] } }).success,
    ).toBe(true);
  });

  it('lets a parked edit hold an enabled schedule with no recipient yet', () => {
    expect(reportScheduleDraftInput.safeParse({ ...weekly, recipients: [] }).success).toBe(true);
  });
});

describe('resolveSchedule', () => {
  it('writes nothing when omitted (never erases what it may not read) and removes on null', () => {
    const stored = resolveSchedule(weekly, null, clock);
    expect(resolveSchedule(undefined, stored ?? null, clock)).toBeUndefined();
    expect(resolveSchedule(null, stored ?? null, clock)).toBeNull();
  });

  it('stamps the store zone and today as the anchor, and drops fields the cadence ignores', () => {
    const stored = resolveSchedule({ ...weekly, cadence: 'daily' }, null, clock);
    expect(stored).toEqual({
      enabled: true,
      cadence: 'daily',
      time: '08:00',
      timeZone: 'America/Sao_Paulo',
      recipients: ['u1'],
      startsOn: '2026-11-16',
    });
  });

  it('dedupes recipients', () => {
    expect(resolveSchedule({ ...weekly, recipients: ['u1', 'u1', 'u2'] }, null, clock)?.recipients).toEqual([
      'u1',
      'u2',
    ]);
  });

  describe('the Quinzenal anchor is the date of the first send (owner, 2026-11-16)', () => {
    const biweekly = { ...weekly, cadence: 'biweekly' as const }; // Monday 08:00 in Sao Paulo
    const at = (iso: string) => ({ timeZone: 'America/Sao_Paulo', now: new Date(iso) });

    it('enabled on the chosen weekday AFTER the time: first send is in 7 days', () => {
      // Monday 2026-11-16 15:00 local = 18:00Z, past 08:00.
      expect(resolveSchedule(biweekly, null, at('2026-11-16T18:00:00Z'))?.startsOn).toBe('2026-11-23');
    });

    it('enabled on the chosen weekday BEFORE the time: first send is today', () => {
      expect(resolveSchedule(biweekly, null, at('2026-11-16T09:00:00Z'))?.startsOn).toBe('2026-11-16');
    });

    it('enabled on another weekday: the next such weekday', () => {
      // Wednesday 2026-11-18.
      expect(resolveSchedule(biweekly, null, at('2026-11-18T12:00:00Z'))?.startsOn).toBe('2026-11-23');
    });

    it('keeps the anchor while the same fortnight continues', () => {
      const first = resolveSchedule(biweekly, null, at('2026-11-16T09:00:00Z')) ?? null;
      const later = at('2026-12-20T12:00:00Z');
      expect(resolveSchedule({ ...biweekly, time: '09:30' }, first, later)?.startsOn).toBe('2026-11-16');
      expect(resolveSchedule({ ...biweekly, weekday: 3 }, first, later)?.startsOn).toBe('2026-12-23');
    });

    it('re-anchors when switched back on after a long pause', () => {
      const first = resolveSchedule(biweekly, null, at('2026-11-16T09:00:00Z')) ?? null;
      const off = resolveSchedule({ ...biweekly, enabled: false }, first, at('2026-11-17T12:00:00Z')) ?? null;
      expect(off?.enabled).toBe(false);
      // Back on in March, a Thursday: parity restarts from the next Monday.
      const again = resolveSchedule(biweekly, off, at('2027-03-04T12:00:00Z'));
      expect(again?.startsOn).toBe('2027-03-08');
    });
  });
});

describe('readSchedule', () => {
  it('reads what resolveSchedule stored', () => {
    const stored = resolveSchedule(weekly, null, clock);
    expect(readSchedule(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('answers null for anything a job could not fully understand', () => {
    expect(readSchedule(null)).toBeNull();
    expect(readSchedule({ enabled: true })).toBeNull();
    expect(readSchedule({ ...resolveSchedule(weekly, null, clock), timeZone: 'Nowhere/City' })).toBeNull();
  });
});
