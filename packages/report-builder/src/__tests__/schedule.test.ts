import { describe, expect, it } from 'vitest';

import { civilDateOf, nextOccurrences, occurrenceKey, type ReportSchedule } from '../schedule';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';

function make(over: Partial<ReportSchedule>): ReportSchedule {
  return {
    enabled: true,
    cadence: 'daily',
    time: '08:00',
    timeZone: SP,
    recipients: [],
    startsOn: '2026-11-02',
    ...over,
  };
}

const iso = (dates: Date[]): string[] => dates.map((date) => date.toISOString());

describe('nextOccurrences', () => {
  it('is empty when disabled or malformed', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(nextOccurrences(make({ enabled: false }), now)).toEqual([]);
    expect(nextOccurrences(make({ time: '25:00' }), now)).toEqual([]);
    expect(nextOccurrences(make({ timeZone: 'Nowhere/City' }), now)).toEqual([]);
    expect(nextOccurrences(make({ cadence: 'weekly' }), now)).toEqual([]);
  });

  it('daily fires at the local time, strictly after the instant', () => {
    // 08:00 in Sao Paulo (UTC-3) is 11:00Z.
    expect(iso(nextOccurrences(make({}), new Date('2026-11-16T10:59:00Z'), 2))).toEqual([
      '2026-11-16T11:00:00.000Z',
      '2026-11-17T11:00:00.000Z',
    ]);
    expect(iso(nextOccurrences(make({}), new Date('2026-11-16T11:00:00Z')))).toEqual([
      '2026-11-17T11:00:00.000Z',
    ]);
  });

  it('weekly lands on the chosen weekday of the zone, not of UTC', () => {
    // Monday 21:30 local is Tuesday 00:30Z.
    const monday = make({ cadence: 'weekly', weekday: 1, time: '21:30' });
    expect(iso(nextOccurrences(monday, new Date('2026-11-16T00:00:00Z'), 2))).toEqual([
      '2026-11-17T00:30:00.000Z',
      '2026-11-24T00:30:00.000Z',
    ]);
  });

  it('biweekly counts every other week from startsOn', () => {
    const schedule = make({ cadence: 'biweekly', weekday: 1, startsOn: '2026-11-02' });
    expect(iso(nextOccurrences(schedule, new Date('2026-11-01T00:00:00Z'), 3))).toEqual([
      '2026-11-02T11:00:00.000Z',
      '2026-11-16T11:00:00.000Z',
      '2026-11-30T11:00:00.000Z',
    ]);
  });

  it('biweekly starts from the first matching weekday on or after startsOn', () => {
    // startsOn is a Wednesday; first Monday on/after is 2026-11-09.
    const schedule = make({ cadence: 'biweekly', weekday: 1, startsOn: '2026-11-04' });
    expect(iso(nextOccurrences(schedule, new Date('2026-11-01T00:00:00Z'), 2))).toEqual([
      '2026-11-09T11:00:00.000Z',
      '2026-11-23T11:00:00.000Z',
    ]);
  });

  it('monthly clamps the 31st to the last day of shorter months', () => {
    const schedule = make({ cadence: 'monthly', dayOfMonth: 31 });
    expect(iso(nextOccurrences(schedule, new Date('2027-01-31T12:00:00Z'), 3))).toEqual([
      '2027-02-28T11:00:00.000Z',
      '2027-03-31T11:00:00.000Z',
      '2027-04-30T11:00:00.000Z',
    ]);
    // Leap year.
    expect(iso(nextOccurrences(schedule, new Date('2028-02-01T00:00:00Z')))).toEqual([
      '2028-02-29T11:00:00.000Z',
    ]);
  });

  it('keeps the wall clock across daylight saving', () => {
    const schedule = make({ timeZone: NY, time: '08:00' });
    // Before the fall-back (EDT, UTC-4) and after it (EST, UTC-5).
    expect(iso(nextOccurrences(schedule, new Date('2026-10-31T13:00:00Z'), 3))).toEqual([
      '2026-11-01T13:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
      '2026-11-03T13:00:00.000Z',
    ]);
    expect(iso(nextOccurrences(schedule, new Date('2026-03-07T13:00:00Z'), 2))).toEqual([
      '2026-03-08T12:00:00.000Z',
      '2026-03-09T12:00:00.000Z',
    ]);
  });

  it('fires once, just after the gap, for a time that does not exist', () => {
    const schedule = make({ timeZone: NY, time: '02:30' });
    expect(iso(nextOccurrences(schedule, new Date('2026-03-07T12:00:00Z'), 3))).toEqual([
      '2026-03-08T07:30:00.000Z', // 03:30 EDT
      '2026-03-09T06:30:00.000Z',
      '2026-03-10T06:30:00.000Z',
    ]);
  });

  it('fires once, at the first, for a time that happens twice', () => {
    const schedule = make({ timeZone: NY, time: '01:30' });
    expect(iso(nextOccurrences(schedule, new Date('2026-10-31T12:00:00Z'), 3))).toEqual([
      '2026-11-01T05:30:00.000Z', // the EDT one
      '2026-11-02T06:30:00.000Z',
      '2026-11-03T06:30:00.000Z',
    ]);
  });
});

describe('occurrenceKey', () => {
  it('names the firing by the wall clock the person chose', () => {
    const schedule = make({ timeZone: NY, time: '08:00' });
    expect(occurrenceKey(schedule, new Date('2026-11-02T13:00:00Z'))).toBe('2026-11-02T08:00');
    expect(occurrenceKey(schedule, new Date('2026-08-02T12:00:00Z'))).toBe('2026-08-02T08:00');
  });
});

describe('civilDateOf', () => {
  it('reads the date in the zone', () => {
    expect(civilDateOf(new Date('2026-11-17T01:00:00Z'), SP)).toBe('2026-11-16');
  });
});
