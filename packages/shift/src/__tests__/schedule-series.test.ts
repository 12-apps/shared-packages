import { describe, expect, it } from 'vitest';

import { createMemoryShiftScheduleDb, createShiftScheduleService, type ShiftScheduleDb } from '../index';
import { BASE, DAY_MS, HOUR_MS, KINDS, NOW, NY, SP, iso, refusal, setup, spDays, weekly } from './schedule-fixture';

describe('scheduleSeries — the rule', () => {
  it('writes the rule, builds its days up to the horizon, and audits it under the rule', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const { series, slots, change } = await fixture.schedule.scheduleSeries(weekly());
    // Today is Tuesday 2026-10-20; two weeks of days end on Monday 2026-11-02.
    expect(spDays(slots)).toEqual(['2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02']);
    expect(slots.every((slot) => slot.seriesId === series?.id && slot.detached === false)).toBe(true);
    expect(slots[0]?.seriesDate).toBe('2026-10-21');
    expect(iso([slots[0]?.startsAt as Date, slots[0]?.endsAt as Date])).toEqual([
      '2026-10-21T13:00:00.000Z',
      '2026-10-21T17:00:00.000Z',
    ]);
    expect(fixture.db.series()).toEqual([expect.objectContaining({ id: series?.id, endsOn: null, skippedDates: [] })]);
    expect(change).toMatchObject({ createdSeriesIds: [series?.id], createdSlotIds: slots.map((slot) => slot.id) });
    expect(fixture.db.audits()).toEqual([
      expect.objectContaining({
        action: 'shift.schedule.series',
        resourceType: 'shift_slot_series',
        resourceId: series?.id,
        after: expect.objectContaining({ weekdays: '1,3', everyWeeks: '1', count: '4' }),
      }),
    ]);
  });

  it.each([
    ['no weekday', { weekdays: [] }],
    ['a weekday out of range', { weekdays: [0] }],
    ['a repeated weekday', { weekdays: [1, 1] }],
    ['both repeats', { everyWeeks: 1 as const, monthlyNth: 2 }],
    ['neither repeat', { everyWeeks: null }],
    ['every three weeks', { everyWeeks: 3 as unknown as 1 }],
    ['a monthly rule on two weekdays', { everyWeeks: null, monthlyNth: 1, weekdays: [1, 3] }],
    ['a sixth weekday of the month', { everyWeeks: null, monthlyNth: 6, weekdays: [1] }],
    ['an unknown zone', { timeZone: 'Mars/Olympus' }],
    ['a start already past', { startsOn: '2026-10-19' }],
    ['an end before the start', { endsOn: '2026-10-20' }],
    ['a date that does not exist', { startsOn: '2026-02-30' }],
    ['minutes past the day', { endMinutes: 1440 }],
    ['an unknown kind', { kind: 'cleaning' as 'ward' }],
  ])('refuses %s, writing nothing', async (_, override) => {
    const world = setup();
    expect(await refusal(world.schedule.scheduleSeries(weekly(override)))).toBe('INVALID_SLOT');
    expect(world.db.series()).toEqual([]);
    expect(world.db.slots()).toEqual([]);
  });

  it('refuses the whole rule when one of its first days clashes with the person’s slot', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    await fixture.schedule.scheduleSlot({
      ...BASE,
      startsAt: new Date('2026-10-28T16:00:00.000Z'),
      endsAt: new Date('2026-10-28T18:00:00.000Z'),
    });
    expect(await refusal(fixture.schedule.scheduleSeries(weekly()))).toBe('SLOT_OVERLAP');
    expect(fixture.db.series()).toEqual([]);
    expect(fixture.db.slots()).toHaveLength(1);
  });

  it('runs into the next day when the end is at or before the start', async () => {
    const fixture = setup({ horizonWeeks: 1 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly({ weekdays: [3], startMinutes: 22 * 60, endMinutes: 6 * 60 }));
    expect(iso([slots[0]?.startsAt as Date, slots[0]?.endsAt as Date])).toEqual([
      '2026-10-22T01:00:00.000Z',
      '2026-10-22T09:00:00.000Z',
    ]);
  });
});

describe('scheduleSeries — weekly, every two weeks and monthly', () => {
  const MONDAYS_NY = { weekdays: [1], startMinutes: 9 * 60, endMinutes: 13 * 60, timeZone: NY, startsOn: '2026-10-26' };

  it('keeps 09:00 on the wall clock across the fall-back, weekly', async () => {
    const fixture = setup({ horizonWeeks: 3 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly(MONDAYS_NY));
    expect(iso(slots.map((slot) => slot.startsAt))).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
    ]);
  });

  it('skips the off weeks, counted from the first week, every two weeks', async () => {
    const fixture = setup({ horizonWeeks: 5 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly({ ...MONDAYS_NY, everyWeeks: 2 }));
    expect(iso(slots.map((slot) => slot.startsAt))).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-09T14:00:00.000Z', '2026-11-23T14:00:00.000Z']);
  });

  it('lands on the Nth weekday of each month, across the fall-back', async () => {
    const fixture = setup({ horizonWeeks: 12 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly({ ...MONDAYS_NY, everyWeeks: null, monthlyNth: 3 }));
    expect(iso(slots.map((slot) => slot.startsAt))).toEqual(['2026-11-16T14:00:00.000Z', '2026-12-21T14:00:00.000Z']);
  });

  it('has no day in a month without a fifth such weekday', async () => {
    // Twenty weeks from 2026-10-20 run to 2027-03-08; twenty-four to 2027-04-05.
    const fixture = setup({ horizonWeeks: 20 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly({ ...MONDAYS_NY, everyWeeks: null, monthlyNth: 5 }));
    // October 2026 and December–February have four Mondays; November and March have five.
    expect(iso(slots.map((slot) => slot.startsAt))).toEqual(['2026-11-30T14:00:00.000Z']);
    const later = setup({ horizonWeeks: 24 });
    const more = await later.schedule.scheduleSeries(weekly({ ...MONDAYS_NY, everyWeeks: null, monthlyNth: 5 }));
    expect(iso(more.slots.map((slot) => slot.startsAt))).toEqual(['2026-11-30T14:00:00.000Z', '2027-03-29T13:00:00.000Z']);
  });
});

describe('the rolling horizon — extendSeries and materialiseSeries', () => {
  it('stops "Sem fim" at the horizon, and two runs a day later add the next days once', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const { series } = await fixture.schedule.scheduleSeries(weekly());
    expect(fixture.live()).toHaveLength(4);
    fixture.setNow(new Date(NOW.getTime() + 2 * DAY_MS)); // Thursday: the horizon now reaches Wednesday 11-04
    const first = await fixture.schedule.extendSeries();
    const second = await fixture.schedule.extendSeries();
    expect(first.built).toEqual([{ clientId: BASE.clientId, seriesId: series?.id, slotIds: [expect.any(String)] }]);
    expect(second).toEqual({ built: [], skipped: [], failures: [] });
    expect(spDays(fixture.live()).at(-1)).toBe('2026-11-04');
    expect(fixture.live()).toHaveLength(5);
  });

  it('honours an explicit now', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    await fixture.schedule.scheduleSeries(weekly());
    const result = await fixture.schedule.extendSeries(new Date(NOW.getTime() + 7 * DAY_MS));
    expect(result.built[0]?.slotIds).toHaveLength(2);
  });

  it('never rebuilds a canceled day', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly());
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: slots[1]?.id ?? '', actorUserId: 'head-1', reason: 'absence' });
    await fixture.schedule.extendSeries();
    expect(spDays(fixture.live())).toEqual(['2026-10-21', '2026-10-28', '2026-11-02']);
  });

  it('skips a day the person is taken, records it on the rule and audits it once', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const { series } = await fixture.schedule.scheduleSeries(weekly());
    await fixture.schedule.scheduleSlot({
      ...BASE,
      startsAt: new Date('2026-11-04T12:00:00.000Z'),
      endsAt: new Date('2026-11-04T14:00:00.000Z'),
    });
    fixture.setNow(new Date(NOW.getTime() + 2 * DAY_MS));
    const first = await fixture.schedule.extendSeries();
    await fixture.schedule.extendSeries();
    expect(first.skipped).toEqual([{ clientId: BASE.clientId, seriesId: series?.id, date: '2026-11-04' }]);
    expect(fixture.db.series()[0]?.skippedDates).toEqual(['2026-11-04']);
    const skippedAudits = fixture.db.audits().filter((audit) => audit.after['skipped'] === '2026-11-04');
    expect(skippedAudits).toEqual([expect.objectContaining({ resourceType: 'shift_slot_series', actorUserId: null })]);
  });

  it('builds nothing for a closed rule or past its end', async () => {
    const fixture = setup({ horizonWeeks: 4 });
    await fixture.schedule.scheduleSeries(weekly({ endsOn: '2026-10-28' }));
    expect(spDays(fixture.live())).toEqual(['2026-10-21', '2026-10-26', '2026-10-28']);
    fixture.setNow(new Date(NOW.getTime() + 7 * DAY_MS));
    expect((await fixture.schedule.extendSeries()).built).toEqual([]);
  });

  it('builds past the horizon on demand, previews without writing, and is idempotent', async () => {
    const fixture = setup({ horizonWeeks: 1 });
    const { series } = await fixture.schedule.scheduleSeries(weekly());
    const input = { clientId: BASE.clientId, seriesId: series?.id ?? '', until: '2026-11-04' };
    const preview = await fixture.schedule.materialiseSeries({ ...input, preview: true });
    expect(preview).toEqual({ dates: ['2026-10-28', '2026-11-02', '2026-11-04'], slotIds: [], skippedDates: [] });
    expect(fixture.live()).toHaveLength(2);
    const built = await fixture.schedule.materialiseSeries(input);
    expect(built.slotIds).toHaveLength(3);
    expect((await fixture.schedule.materialiseSeries(input)).slotIds).toEqual([]);
    expect(await refusal(fixture.schedule.materialiseSeries({ ...input, seriesId: 'nope' }))).toBe('SERIES_NOT_FOUND');
    expect(await refusal(fixture.schedule.materialiseSeries({ ...input, until: 'soon' }))).toBe('INVALID_SLOT');
  });

  it('reports a rule that fails and carries on with the others', async () => {
    const memory = createMemoryShiftScheduleDb();
    const broken = new Set<string>();
    const db: ShiftScheduleDb = {
      ...memory,
      transaction: (work) =>
        memory.transaction((tx) =>
          work({
            ...tx,
            getSeries: async (clientId, seriesId) => {
              if (broken.has(seriesId)) throw new Error('row moved');
              return tx.getSeries(clientId, seriesId);
            },
          }),
        ),
    };
    const clock = { now: NOW };
    const schedule = createShiftScheduleService(db, { kinds: KINDS, now: () => clock.now, horizonWeeks: 1 });
    const bad = await schedule.scheduleSeries(weekly());
    const good = await schedule.scheduleSeries(weekly({ userId: 'nurse-2' }));
    broken.add(bad.series?.id ?? '');
    clock.now = new Date(NOW.getTime() + 7 * DAY_MS);
    const result = await schedule.extendSeries();
    expect(result.failures).toEqual([{ clientId: BASE.clientId, seriesId: bad.series?.id, message: 'row moved' }]);
    expect(result.built.map((entry) => entry.seriesId)).toEqual([good.series?.id]);
  });
});

describe('the break', () => {
  it.each([
    ['an offset with no length', { breakOffsetMinutes: 60 }],
    ['a length with no offset', { breakMinutes: 30 }],
    ['a break at the very start', { breakOffsetMinutes: 0, breakMinutes: 30 }],
    ['a break reaching the end', { breakOffsetMinutes: 210, breakMinutes: 30 }],
    ['a fractional break', { breakOffsetMinutes: 60, breakMinutes: 0.5 }],
  ])('refuses %s, on a slot and on a rule', async (_, pair) => {
    const world = setup();
    const slot = { ...BASE, startsAt: new Date(NOW.getTime() + DAY_MS), endsAt: new Date(NOW.getTime() + DAY_MS + 4 * HOUR_MS) };
    expect(await refusal(world.schedule.scheduleSlot({ ...slot, ...pair }))).toBe('INVALID_SLOT');
    expect(await refusal(world.schedule.scheduleSeries(weekly(pair)))).toBe('INVALID_SLOT');
  });

  it('keeps a break that ends one minute before the slot, and copies it onto each weekly repeat', async () => {
    const fixture = setup();
    const start = new Date(NOW.getTime() + DAY_MS);
    const slots = await fixture.schedule.scheduleSlot({
      ...BASE,
      startsAt: start,
      endsAt: new Date(start.getTime() + 4 * HOUR_MS),
      breakOffsetMinutes: 209,
      breakMinutes: 30,
      repeatWeeks: 1,
      timeZone: SP,
    });
    expect(slots.map((slot) => [slot.breakOffsetMinutes, slot.breakMinutes])).toEqual([[209, 30], [209, 30]]);
  });

  it('materialises the rule’s break on every day, across midnight and the fall-back', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    // 22:00–06:00 every Saturday in New York; the night of 10-31 gains an hour.
    const { slots } = await fixture.schedule.scheduleSeries(
      weekly({ weekdays: [6], startMinutes: 22 * 60, endMinutes: 6 * 60, timeZone: NY, startsOn: '2026-10-24', breakOffsetMinutes: 240, breakMinutes: 30 }),
    );
    expect(slots.map((slot) => (slot.endsAt.getTime() - slot.startsAt.getTime()) / HOUR_MS)).toEqual([8, 9]);
    expect(slots.every((slot) => slot.breakOffsetMinutes === 240 && slot.breakMinutes === 30)).toBe(true);
    fixture.setNow(new Date(NOW.getTime() + 7 * DAY_MS));
    const { built } = await fixture.schedule.extendSeries();
    const extended = fixture.live().filter((slot) => built[0]?.slotIds.includes(slot.id));
    expect(extended.map((slot) => [slot.breakOffsetMinutes, slot.breakMinutes])).toEqual([[240, 30]]);
  });
});
