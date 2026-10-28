import { describe, expect, it } from 'vitest';

import { BASE, DAY_MS, HOUR_MS, NOW, SP, refusal, setup, spDays, weekly } from './schedule-fixture';

async function withSeries(horizonWeeks = 2) {
  const made = setup({ horizonWeeks });
  const written = await made.schedule.scheduleSeries(weekly());
  return { ...made, series: written.series, rows: written.slots };
}

const edit = (slotId: string, patch: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  clientId: BASE.clientId,
  slotId,
  actorUserId: 'head-1',
  patch,
  ...extra,
});

describe('editSlot — one row, in place', () => {
  it('moves the hours of one day, keeps the id, detaches it, and audits only what moved', async () => {
    const fixture = await withSeries();
    const row = fixture.rows[1];
    const { slots } = await fixture.schedule.editSlot(edit(row?.id ?? '', { startMinutes: 11 * 60, endMinutes: 15 * 60 }));
    expect(slots[0]).toMatchObject({ id: row?.id, detached: true, seriesId: fixture.series?.id, seriesDate: '2026-10-26' });
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-10-26T14:00:00.000Z');
    expect(fixture.db.audits().at(-1)).toMatchObject({
      action: 'shift.schedule.edit',
      resourceType: 'shift_slot',
      resourceId: row?.id,
      before: { seriesId: fixture.series?.id, startsAt: '2026-10-26T13:00:00.000Z', endsAt: '2026-10-26T17:00:00.000Z', detached: 'false' },
      after: { seriesId: fixture.series?.id, startsAt: '2026-10-26T14:00:00.000Z', endsAt: '2026-10-26T18:00:00.000Z', detached: 'true' },
    });
  });

  it('moves a row to another date, and the rule does not rebuild the day it left', async () => {
    const fixture = await withSeries();
    await fixture.schedule.editSlot(edit(fixture.rows[1]?.id ?? '', { date: '2026-10-27' }));
    await fixture.schedule.extendSeries();
    await fixture.schedule.materialiseSeries({ clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', until: '2026-11-02' });
    expect(spDays(fixture.live())).toEqual(['2026-10-21', '2026-10-27', '2026-10-28', '2026-11-02']);
  });

  it('does not rebuild the day a row left, however far it was moved', async () => {
    const fixture = await withSeries();
    // Monday 10-26 moved three weeks on, well past the days being built.
    await fixture.schedule.editSlot(edit(fixture.rows[1]?.id ?? '', { date: '2026-11-17' }));
    await fixture.schedule.materialiseSeries({ clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', until: '2026-11-04' });
    expect(spDays(fixture.live())).toEqual(['2026-10-21', '2026-10-28', '2026-11-02', '2026-11-04', '2026-11-17']);
  });

  it('hands a row to another person out of its series, leaving detached as it was', async () => {
    const fixture = await withSeries();
    const row = fixture.rows[2];
    const { slots } = await fixture.schedule.editSlot(edit(row?.id ?? '', { userId: 'nurse-2' }));
    expect(slots[0]).toMatchObject({ userId: 'nurse-2', seriesId: null, originSeriesId: fixture.series?.id, detached: false });
    // The owner's `following` cancel and the extension never reach the handed-out row.
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: fixture.rows[1]?.id ?? '', actorUserId: 'head-1', scope: 'following' });
    await fixture.schedule.extendSeries();
    expect(fixture.live().map((slot) => [slot.userId, slot.id])).toEqual([
      ['nurse-1', fixture.rows[0]?.id],
      ['nurse-2', row?.id],
    ]);
  });

  it('puts a handed-out row back with rejoinSeries — to the rule’s person only, and into an ended rule too', async () => {
    const fixture = await withSeries();
    const row = fixture.rows[3];
    await fixture.schedule.editSlot(edit(row?.id ?? '', { userId: 'nurse-2' }));
    expect(await refusal(fixture.schedule.editSlot(edit(row?.id ?? '', { userId: 'nurse-3' }, { rejoinSeries: true })))).toBe(
      'INVALID_SLOT',
    );
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: fixture.rows[1]?.id ?? '', actorUserId: 'head-1', scope: 'following' });
    expect(fixture.db.series()[0]?.endsOn).toBe('2026-10-25');
    const { slots } = await fixture.schedule.editSlot(edit(row?.id ?? '', { userId: BASE.userId }, { rejoinSeries: true }));
    expect(slots[0]).toMatchObject({ userId: BASE.userId, seriesId: fixture.series?.id, originSeriesId: null, detached: false });
  });

  it('refuses a rejoin with no hand-over, an overlap, an ended slot and a past start', async () => {
    const fixture = await withSeries();
    const id = fixture.rows[0]?.id ?? '';
    expect(await refusal(fixture.schedule.editSlot(edit(id, {}, { rejoinSeries: true })))).toBe('INVALID_SLOT');
    await fixture.schedule.scheduleSlot({ ...BASE, userId: 'nurse-2', startsAt: fixture.rows[0]?.startsAt as Date, endsAt: fixture.rows[0]?.endsAt as Date });
    expect(await refusal(fixture.schedule.editSlot(edit(id, { userId: 'nurse-2' })))).toBe('SLOT_OVERLAP');
    expect(await refusal(fixture.schedule.editSlot(edit(id, { date: '2026-10-19' })))).toBe('INVALID_SLOT');
    fixture.setNow(new Date('2026-10-21T18:00:00.000Z'));
    expect(await refusal(fixture.schedule.editSlot(edit(id, { endMinutes: 16 * 60 })))).toBe('SLOT_OVER');
  });

  it('sets, keeps and refuses a break', async () => {
    const fixture = await withSeries();
    const id = fixture.rows[0]?.id ?? '';
    const set = await fixture.schedule.editSlot(edit(id, { breakOffsetMinutes: 120, breakMinutes: 30 }));
    expect(set.slots[0]).toMatchObject({ breakOffsetMinutes: 120, breakMinutes: 30, detached: false });
    expect(await refusal(fixture.schedule.editSlot(edit(id, { endMinutes: 12 * 60 })))).toBe('INVALID_SLOT');
    expect(await refusal(fixture.schedule.editSlot(edit(id, { breakMinutes: null })))).toBe('INVALID_SLOT');
    const cleared = await fixture.schedule.editSlot(edit(id, { breakOffsetMinutes: null, breakMinutes: null }));
    expect(cleared.slots[0]).toMatchObject({ breakOffsetMinutes: null, breakMinutes: null });
  });

  it('needs a zone to move a slot that is on no series', async () => {
    const fixture = setup();
    const [single] = await fixture.schedule.scheduleSlot({ ...BASE, startsAt: new Date(NOW.getTime() + DAY_MS), endsAt: new Date(NOW.getTime() + DAY_MS + 4 * HOUR_MS) });
    expect(await refusal(fixture.schedule.editSlot(edit(single?.id ?? '', { startMinutes: 600 })))).toBe('INVALID_SLOT');
    const { slots } = await fixture.schedule.editSlot(edit(single?.id ?? '', { startMinutes: 600 }, { timeZone: SP }));
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-10-21T13:00:00.000Z');
  });
});

describe('a slot under way — allowRunning', () => {
  const running = { ...BASE, startsAt: new Date(NOW.getTime() - HOUR_MS), endsAt: new Date(NOW.getTime() + 3 * HOUR_MS) };

  it('admits a substitute whose slot already started, and only with the flag', async () => {
    const fixture = setup();
    expect(await refusal(fixture.schedule.scheduleSlot(running))).toBe('INVALID_SLOT');
    await expect(fixture.schedule.scheduleSlot({ ...running, allowRunning: true })).resolves.toHaveLength(1);
    const ended = { ...running, startsAt: new Date(NOW.getTime() - 3 * HOUR_MS), endsAt: new Date(NOW.getTime() - HOUR_MS) };
    expect(await refusal(fixture.schedule.scheduleSlot({ ...ended, allowRunning: true }))).toBe('INVALID_SLOT');
  });

  it('reassigns a running slot, and moves its end only with the flag', async () => {
    const fixture = setup();
    const [slot] = await fixture.schedule.scheduleSlot({ ...running, allowRunning: true });
    const id = slot?.id ?? '';
    await expect(fixture.schedule.editSlot(edit(id, { userId: 'nurse-2' }))).resolves.toBeTruthy();
    expect(await refusal(fixture.schedule.editSlot(edit(id, { endMinutes: 14 * 60 }, { timeZone: SP })))).toBe('INVALID_SLOT');
    const { slots } = await fixture.schedule.editSlot(edit(id, { endMinutes: 14 * 60 }, { timeZone: SP, allowRunning: true }));
    expect(slots[0]?.endsAt.toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });
});

describe('editSeries — from a day on', () => {
  it('closes the rule the day before, opens its successor, keeps detached rows and the days before', async () => {
    const fixture = await withSeries(3);
    const [first, , detached, , handed] = fixture.rows;
    await fixture.schedule.editSlot(edit(detached?.id ?? '', { startMinutes: 7 * 60, endMinutes: 9 * 60 }));
    await fixture.schedule.editSlot(edit(handed?.id ?? '', { userId: 'nurse-2' }));
    const { series, change } = await fixture.schedule.editSeries({
      clientId: BASE.clientId,
      seriesId: fixture.series?.id ?? '',
      actorUserId: 'head-1',
      from: '2026-10-26',
      patch: { startMinutes: 15 * 60, endMinutes: 19 * 60, breakOffsetMinutes: 60, breakMinutes: 15 },
    });
    const [old, next] = fixture.db.series();
    expect(old).toMatchObject({ id: fixture.series?.id, endsOn: '2026-10-25' });
    expect(next).toMatchObject({ id: series?.id, previousSeriesId: old?.id, startsOn: '2026-10-26', endsOn: null, skippedDates: ['2026-10-28'] });
    const live = fixture.live();
    expect(live.find((slot) => slot.id === first?.id)).toBeDefined();
    expect(live.find((slot) => slot.id === detached?.id)?.seriesId).toBe(old?.id);
    expect(live.find((slot) => slot.id === handed?.id)).toBeUndefined();
    const rebuilt = live.filter((slot) => slot.seriesId === next?.id);
    expect(spDays(rebuilt)).toEqual(['2026-10-26', '2026-11-02', '2026-11-04', '2026-11-09']);
    expect(rebuilt.every((slot) => slot.breakMinutes === 15 && slot.startsAt.toISOString().endsWith('T18:00:00.000Z'))).toBe(true);
    const canceled = fixture.db.slots().filter((slot) => change.canceledSlotIds.includes(slot.id));
    expect(new Set(canceled.map((slot) => slot.cancelReason))).toEqual(new Set(['series-edit']));
    expect(canceled.map((slot) => slot.id)).toContain(handed?.id);
  });

  it('turns a series written before rules into a rule first, and needs its zone', async () => {
    const fixture = setup({ horizonWeeks: 4 });
    const legacy = await fixture.schedule.scheduleSlot({
      ...BASE,
      startsAt: new Date('2026-10-21T13:00:00.000Z'),
      endsAt: new Date('2026-10-21T17:00:00.000Z'),
      repeatWeeks: 2,
      timeZone: SP,
    });
    const input = { clientId: BASE.clientId, seriesId: legacy[0]?.seriesId ?? '', actorUserId: 'head-1', from: '2026-10-28', patch: { endMinutes: 16 * 60 } };
    expect(await refusal(fixture.schedule.editSeries(input))).toBe('INVALID_SLOT');
    const { series } = await fixture.schedule.editSeries({ ...input, timeZone: SP });
    expect(fixture.db.series().map((rule) => [rule.id, rule.startsOn, rule.endsOn])).toEqual([
      [legacy[0]?.seriesId, '2026-10-21', '2026-10-27'],
      [series?.id, '2026-10-28', '2026-11-04'],
    ]);
    expect(spDays(fixture.live())).toEqual(['2026-10-21', '2026-10-28', '2026-11-04']);
    await fixture.schedule.extendSeries();
    expect(fixture.live()).toHaveLength(3);
  });

  it('refuses a day already past, an unknown series and a clash', async () => {
    const fixture = await withSeries();
    const input = { clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', actorUserId: 'head-1', from: '2026-10-19', patch: {} };
    expect(await refusal(fixture.schedule.editSeries(input))).toBe('INVALID_SLOT');
    expect(await refusal(fixture.schedule.editSeries({ ...input, seriesId: 'nope', from: '2026-10-26' }))).toBe('SERIES_NOT_FOUND');
    await fixture.schedule.scheduleSlot({ ...BASE, startsAt: new Date('2026-10-27T13:00:00.000Z'), endsAt: new Date('2026-10-27T15:00:00.000Z') });
    expect(await refusal(fixture.schedule.editSeries({ ...input, from: '2026-10-26', patch: { weekdays: [2] } }))).toBe('SLOT_OVERLAP');
    expect(fixture.db.series()).toHaveLength(1);
  });
});

describe('promoteToSeries and demoteToSlot', () => {
  async function singles(break_: { breakOffsetMinutes?: number; breakMinutes?: number } = {}) {
    const world = setup({ horizonWeeks: 2 });
    const at = (iso: string, endIso: string) => world.schedule.scheduleSlot({ ...BASE, startsAt: new Date(iso), endsAt: new Date(endIso), ...break_ });
    const [monday] = await at('2026-10-26T13:00:00.000Z', '2026-10-26T17:00:00.000Z');
    const [wednesday] = await at('2026-10-21T13:00:00.000Z', '2026-10-21T17:00:00.000Z');
    return { ...world, ids: [monday?.id ?? '', wednesday?.id ?? ''] };
  }

  it('turns one person’s singles into a rule with their weekdays and break, canceling the singles', async () => {
    const fixture = await singles({ breakOffsetMinutes: 90, breakMinutes: 30 });
    const { series, slots } = await fixture.schedule.promoteToSeries({
      clientId: BASE.clientId,
      slotIds: fixture.ids,
      actorUserId: 'head-1',
      rule: { everyWeeks: 1, timeZone: SP },
    });
    expect(series).toMatchObject({ weekdays: [1, 3], startsOn: '2026-10-21', startMinutes: 600, endMinutes: 840, breakOffsetMinutes: 90, breakMinutes: 30 });
    expect(spDays(slots)).toEqual(['2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02']);
    expect(slots.every((slot) => slot.breakOffsetMinutes === 90 && slot.breakMinutes === 30)).toBe(true);
    const promoted = fixture.db.slots().filter((slot) => fixture.ids.includes(slot.id));
    expect(promoted.map((slot) => slot.cancelReason)).toEqual(['promoted', 'promoted']);
    expect(fixture.db.audits().filter((audit) => audit.action === 'shift.schedule.promote')).toHaveLength(3);
  });

  it('refuses slots of different hours, a series row and a slot under way', async () => {
    const fixture = await singles();
    const [late] = await fixture.schedule.scheduleSlot({ ...BASE, startsAt: new Date('2026-10-23T14:00:00.000Z'), endsAt: new Date('2026-10-23T17:00:00.000Z') });
    const promote = (slotIds: string[]) =>
      fixture.schedule.promoteToSeries({ clientId: BASE.clientId, slotIds, actorUserId: 'head-1', rule: { everyWeeks: 1, timeZone: SP } });
    expect(await refusal(promote([...fixture.ids, late?.id ?? '']))).toBe('INVALID_SLOT');
    const rule = await fixture.schedule.scheduleSeries(weekly({ userId: 'nurse-2' }));
    expect(await refusal(promote([rule.slots[0]?.id ?? '']))).toBe('INVALID_SLOT');
    const [running] = await fixture.schedule.scheduleSlot({ ...BASE, startsAt: new Date(NOW.getTime() - HOUR_MS), endsAt: new Date(NOW.getTime() + HOUR_MS), allowRunning: true });
    expect(await refusal(promote([running?.id ?? '']))).toBe('INVALID_SLOT');
  });

  it('ends a rule into one detached single, canceling its other future days', async () => {
    const fixture = await withSeries();
    const { slots, change } = await fixture.schedule.demoteToSlot({
      clientId: BASE.clientId,
      seriesId: fixture.series?.id ?? '',
      keepDate: '2026-10-28',
      actorUserId: 'head-1',
    });
    expect(slots[0]).toMatchObject({ id: fixture.rows[2]?.id, seriesId: null, originSeriesId: fixture.series?.id, detached: true });
    expect(fixture.live().map((slot) => slot.id)).toEqual([fixture.rows[2]?.id]);
    expect(change.canceledSlotIds).toHaveLength(3);
    expect(fixture.db.series()[0]?.endsOn).toBe('2026-10-19');
    await fixture.schedule.extendSeries(new Date(NOW.getTime() + 7 * DAY_MS));
    expect(fixture.live()).toHaveLength(1);
    expect(await refusal(fixture.schedule.demoteToSlot({ clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', keepDate: '2026-10-29', actorUserId: 'head-1' }))).toBe('SLOT_NOT_FOUND');
  });
});
