import { describe, expect, it } from 'vitest';

import type { ScheduleChange } from '../index';
import { BASE, DAY_MS, NOW, NY, SP, refusal, setup, spDays, weekly } from './schedule-fixture';

const actor = { clientId: BASE.clientId, actorUserId: 'head-1' };

function revertOf(made: ReturnType<typeof setup>) {
  return (change: ScheduleChange) => made.schedule.revertScheduleChange({ ...actor, change });
}

/** Local start time in São Paulo (UTC−3), as `HH:MM`. */
function spTime(slot: { startsAt: Date }): string {
  return new Date(slot.startsAt.getTime() - 3 * 60 * 60_000).toISOString().slice(11, 16);
}

describe('editSeries keeps an every-two-weeks rule on its weeks', () => {
  it('starts the successor in the old rule’s next on week when `from` is an off week', async () => {
    const fixture = setup({ horizonWeeks: 6 });
    // Mondays every two weeks from 2026-10-26: on weeks 10-26, 11-09, 11-23.
    const { series } = await fixture.schedule.scheduleSeries(
      weekly({ weekdays: [1], everyWeeks: 2, startsOn: '2026-10-26' }),
    );
    expect(spDays(fixture.live())).toEqual(['2026-10-26', '2026-11-09', '2026-11-23']);
    const edited = await fixture.schedule.editSeries({
      ...actor,
      seriesId: series?.id ?? '',
      from: '2026-11-03',
      patch: { startMinutes: 11 * 60 },
    });
    expect(edited.series?.startsOn).toBe('2026-11-09');
    expect(fixture.live().map((slot) => `${spDays([slot])[0]} ${spTime(slot)}`).sort()).toEqual([
      '2026-10-26 10:00',
      '2026-11-09 11:00',
      '2026-11-23 11:00',
    ]);
  });

  it('starts it on `from` when that week is an on week', async () => {
    const fixture = setup({ horizonWeeks: 6 });
    const { series } = await fixture.schedule.scheduleSeries(
      weekly({ weekdays: [1], everyWeeks: 2, startsOn: '2026-10-26' }),
    );
    const edited = await fixture.schedule.editSeries({ ...actor, seriesId: series?.id ?? '', from: '2026-11-10', patch: { startMinutes: 11 * 60 } });
    expect(edited.series?.startsOn).toBe('2026-11-10');
    expect(spDays(fixture.live())).toEqual(['2026-10-26', '2026-11-09', '2026-11-23']);
  });
});

describe('promoteToSeries refuses a single the rule does not fall on', () => {
  const single = (day: string) => ({
    ...BASE,
    startsAt: new Date(`${day}T13:00:00.000Z`),
    endsAt: new Date(`${day}T17:00:00.000Z`),
    timeZone: SP,
  });

  it.each([
    ['a 4th-Monday single under monthlyNth 1', ['2026-10-26'], { monthlyNth: 1 }],
    ['an off-week Wednesday under every two weeks', ['2026-10-26', '2026-11-04'], { everyWeeks: 2 as const }],
  ])('%s, canceling nothing', async (_, days, repeat) => {
    const world = setup({ horizonWeeks: 12 });
    const ids: string[] = [];
    for (const day of days) ids.push((await world.schedule.scheduleSlot(single(day)))[0]?.id ?? '');
    const code = await refusal(world.schedule.promoteToSeries({ ...actor, slotIds: ids, rule: { timeZone: SP, ...repeat } }));
    expect(code).toBe('INVALID_SLOT');
    expect(world.db.series()).toEqual([]);
    expect(spDays(world.live())).toEqual(days);
  });
});

describe('a row moved far before the day it was built for', () => {
  async function farMoved() {
    const made = setup({ horizonWeeks: 2 });
    const { series } = await made.schedule.scheduleSeries(weekly({ weekdays: [1] }));
    const built = await made.schedule.materialiseSeries({ clientId: BASE.clientId, seriesId: series?.id ?? '', until: '2027-03-01' });
    expect(built.dates.at(-1)).toBe('2027-03-01');
    await made.schedule.editSlot({ ...actor, slotId: built.slotIds.at(-1) ?? '', patch: { date: '2026-10-28' } });
    return { ...made, seriesId: series?.id ?? '' };
  }
  const onMarch1 = (made: ReturnType<typeof setup>) => made.live().filter((slot) => spDays([slot])[0] === '2027-03-01');

  it('is not rebuilt by the extension', async () => {
    const fixture = await farMoved();
    await fixture.schedule.extendSeries(new Date('2027-02-20T12:00:00.000Z'));
    expect(onMarch1(fixture)).toEqual([]);
  });

  it('keeps its day out of a series edit’s successor', async () => {
    const fixture = await farMoved();
    const edited = await fixture.schedule.editSeries({ ...actor, seriesId: fixture.seriesId, from: '2026-11-02', patch: { startMinutes: 11 * 60 } });
    expect(edited.series?.skippedDates).toEqual(['2027-03-01']);
    expect(fixture.live().find((slot) => slot.seriesDate === '2027-03-01')).toMatchObject({ seriesId: fixture.seriesId, detached: true });
    await fixture.schedule.extendSeries(new Date('2027-02-20T12:00:00.000Z'));
    expect(onMarch1(fixture)).toEqual([]);
  });
});

describe('an undo never touches a row handed to another person', () => {
  it('leaves a later-built row handed out of a created rule as that person’s', async () => {
    const fixture = setup({ horizonWeeks: 1 });
    const written = await fixture.schedule.scheduleSeries(weekly());
    await fixture.schedule.extendSeries(new Date(NOW.getTime() + 3 * DAY_MS));
    const later = fixture.live().find((slot) => !written.change.createdSlotIds.includes(slot.id));
    await fixture.schedule.editSlot({ ...actor, slotId: later?.id ?? '', patch: { userId: 'nurse-2' } });
    await revertOf(fixture)(written.change);
    expect(fixture.live()).toEqual([
      expect.objectContaining({ id: later?.id, userId: 'nurse-2', seriesId: null, originSeriesId: written.series?.id }),
    ]);
  });

  it('undoes a series edit after a hand-out: the handed row stays, the old rule does not rebuild its day', async () => {
    const fixture = setup({ horizonWeeks: 1 });
    const { series } = await fixture.schedule.scheduleSeries(weekly());
    const edited = await fixture.schedule.editSeries({ ...actor, seriesId: series?.id ?? '', from: '2026-10-26', patch: { startMinutes: 11 * 60 } });
    fixture.setNow(new Date(NOW.getTime() + 3 * DAY_MS));
    await fixture.schedule.extendSeries();
    const handed = fixture.live().find((slot) => slot.seriesDate === '2026-10-28');
    await fixture.schedule.editSlot({ ...actor, slotId: handed?.id ?? '', patch: { userId: 'nurse-2' } });
    await revertOf(fixture)(edited.change);
    expect(fixture.db.series().find((rule) => rule.id === series?.id)).toMatchObject({ endsOn: null, skippedDates: ['2026-10-28'] });
    await fixture.schedule.extendSeries();
    const live = fixture.live().map((slot) => `${spDays([slot])[0]} ${slot.userId} ${spTime(slot)}`).sort();
    expect(live).toEqual(['2026-10-21 nurse-1 10:00', '2026-10-26 nurse-1 10:00', '2026-10-28 nurse-2 11:00']);
  });
});

describe('an undone restore leaves the rule restorable', () => {
  it('puts the memory of the following cancel back, so a second restore reopens the rule', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const { slots } = await fixture.schedule.scheduleSeries(weekly());
    const canceled = await fixture.schedule.cancelSlot({ ...actor, slotId: slots[1]?.id ?? '', reason: 'store', scope: 'following' });
    const slotIds = canceled.map((slot) => slot.id);
    const restored = await fixture.schedule.restoreSlot({ ...actor, slotIds, restorableReasons: ['store'] });
    await revertOf(fixture)(restored.change);
    expect(fixture.db.series()[0]).toMatchObject({ endsOn: '2026-10-25', canceledFrom: '2026-10-26', endsOnBeforeCancel: null });
    await fixture.schedule.restoreSlot({ ...actor, slotIds, restorableReasons: ['store', 'undo'] });
    expect(fixture.db.series()[0]).toMatchObject({ endsOn: null, canceledFrom: null });
    expect(fixture.live()).toHaveLength(4);
  });
});

describe('editSeries from today while today’s row is under way', () => {
  it('keeps the running row and leaves today out of the successor', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const { series } = await fixture.schedule.scheduleSeries(weekly());
    // Wednesday 2026-10-21, 11:00 in São Paulo: the 10:00–14:00 row is under way.
    fixture.setNow(new Date('2026-10-21T14:00:00.000Z'));
    const running = fixture.live().find((slot) => slot.seriesDate === '2026-10-21');
    const edited = await fixture.schedule.editSeries({ ...actor, seriesId: series?.id ?? '', from: '2026-10-21', patch: { startMinutes: 11 * 60 } });
    expect(edited.series?.skippedDates).toEqual(['2026-10-21']);
    expect(fixture.live().filter((slot) => spDays([slot])[0] === '2026-10-21')).toEqual([
      expect.objectContaining({ id: running?.id, seriesId: series?.id }),
    ]);
    expect(edited.slots.map((slot) => slot.seriesDate)).toEqual(['2026-10-26', '2026-10-28', '2026-11-02']);
  });
});

describe('hours inside a spring-forward gap', () => {
  // New York springs forward on 2027-03-14: 02:00 jumps to 03:00.
  const SUNDAYS_NY = { weekdays: [7], startMinutes: 2 * 60 + 30, endMinutes: 6 * 60, timeZone: NY };

  it('refuses a write that would build that day, with WALL_CLOCK_GAP', async () => {
    const fixture = setup({ horizonWeeks: 3 });
    fixture.setNow(new Date('2027-03-01T12:00:00.000Z'));
    expect(await refusal(fixture.schedule.scheduleSeries(weekly({ ...SUNDAYS_NY, startsOn: '2027-03-07' })))).toBe('WALL_CLOCK_GAP');
    expect(fixture.db.series()).toEqual([]);
  });

  it('skips that day in the extension, records it on the rule and audits it', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    fixture.setNow(new Date('2027-02-01T12:00:00.000Z'));
    const { series } = await fixture.schedule.scheduleSeries(weekly({ ...SUNDAYS_NY, startsOn: '2027-02-07' }));
    // From 2027-03-08 the horizon reaches 03-21, the gap's day included.
    const result = await fixture.schedule.extendSeries(new Date('2027-03-08T12:00:00.000Z'));
    expect(result.skipped).toEqual([{ clientId: BASE.clientId, seriesId: series?.id, date: '2027-03-14' }]);
    expect(fixture.db.series()[0]?.skippedDates).toEqual(['2027-03-14']);
    expect(fixture.live().map((slot) => slot.seriesDate)).toEqual(['2027-02-07', '2027-02-14', '2027-03-21']);
    expect(fixture.db.audits().at(-1)).toMatchObject({ action: 'shift.schedule.series', after: expect.objectContaining({ skipped: '2027-03-14' }) });
  });

  it('refuses moving one slot into the gap', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    fixture.setNow(new Date('2027-03-01T12:00:00.000Z'));
    const { slots } = await fixture.schedule.scheduleSeries(weekly({ ...SUNDAYS_NY, startMinutes: 4 * 60, startsOn: '2027-03-07' }));
    const moved = fixture.schedule.editSlot({ ...actor, slotId: slots[0]?.id ?? '', patch: { date: '2027-03-14', startMinutes: 2 * 60 + 15 } });
    expect(await refusal(moved)).toBe('WALL_CLOCK_GAP');
  });
});
