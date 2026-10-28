import { describe, expect, it } from 'vitest';

import type { ScheduleChange } from '../index';
import { BASE, DAY_MS, HOUR_MS, NOW, SP, refusal, setup, spDays, weekly } from './schedule-fixture';

const HOST_REASONS = ['store', 'absence'];

async function withSeries() {
  const made = setup({ horizonWeeks: 2 });
  const written = await made.schedule.scheduleSeries(weekly());
  const revert = (change: ScheduleChange) =>
    made.schedule.revertScheduleChange({ clientId: BASE.clientId, change, actorUserId: 'head-1' });
  return { ...made, series: written.series, rows: written.slots, created: written.change, revert };
}

/** The live slots as `[day, id]`, to compare whole schedules before and after. */
function schedule(made: { live: () => { id: string; startsAt: Date }[] }): string[] {
  return made
    .live()
    .map((slot) => `${spDays([slot])[0]} ${slot.id}`)
    .sort();
}

describe('cancel following ends the rule, and its restore reopens it', () => {
  it('ends the rule the day before, and a restore of those rows gives the end back', async () => {
    const fixture = await withSeries();
    const canceled = await fixture.schedule.cancelSlot({
      clientId: BASE.clientId,
      slotId: fixture.rows[1]?.id ?? '',
      actorUserId: 'head-1',
      reason: 'store',
      scope: 'following',
    });
    expect(canceled).toHaveLength(3);
    expect(canceled.change).toMatchObject({ canceledSlotIds: canceled.map((slot) => slot.id), closedSeries: [{ id: fixture.series?.id, priorEndsOn: null }] });
    expect(fixture.db.series()[0]).toMatchObject({ endsOn: '2026-10-25', canceledFrom: '2026-10-26' });
    await fixture.schedule.extendSeries(new Date(NOW.getTime() + 7 * DAY_MS));
    expect(fixture.live()).toHaveLength(1);
    await fixture.schedule.restoreSlot({ clientId: BASE.clientId, slotIds: canceled.map((slot) => slot.id), actorUserId: 'head-1', restorableReasons: HOST_REASONS });
    expect(fixture.db.series()[0]).toMatchObject({ endsOn: null, canceledFrom: null, endsOnBeforeCancel: null });
    expect(fixture.live()).toHaveLength(4);
  });

  it('carries a change on a legacy series too, which has no rule to end', async () => {
    const fixture = setup();
    const legacy = await fixture.schedule.scheduleSlot({ ...BASE, startsAt: new Date(NOW.getTime() + DAY_MS), endsAt: new Date(NOW.getTime() + DAY_MS + HOUR_MS), repeatWeeks: 2, timeZone: SP });
    const canceled = await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: legacy[1]?.id ?? '', actorUserId: 'head-1', scope: 'following' });
    expect(canceled.change.closedSeries).toEqual([]);
    expect(canceled.change.canceledSlotIds).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(canceled))).toHaveLength(2);
  });
});

describe('restoreSlot', () => {
  it.each(['store', 'absence'])('clears a %s cancel, a running slot included', async (reason) => {
    const world = setup();
    const [slot] = await world.schedule.scheduleSlot({ ...BASE, startsAt: new Date(NOW.getTime() + HOUR_MS), endsAt: new Date(NOW.getTime() + 5 * HOUR_MS) });
    await world.schedule.cancelSlot({ clientId: BASE.clientId, slotId: slot?.id ?? '', actorUserId: 'head-1', reason });
    world.setNow(new Date(NOW.getTime() + 2 * HOUR_MS));
    const { slots } = await world.schedule.restoreSlot({ clientId: BASE.clientId, slotIds: [slot?.id ?? ''], actorUserId: 'head-1', restorableReasons: HOST_REASONS });
    expect(slots[0]).toMatchObject({ id: slot?.id, canceledAt: null, cancelReason: null, canceledByUserId: null });
    expect(world.db.audits().at(-1)).toMatchObject({ action: 'shift.schedule.restore', resourceId: slot?.id, before: { cancelReason: reason } });
  });

  it('refuses once ended, a reason the host does not name, a live slot and a new overlap', async () => {
    const fixture = setup();
    const at = (offset: number) => ({ ...BASE, startsAt: new Date(NOW.getTime() + offset), endsAt: new Date(NOW.getTime() + offset + 2 * HOUR_MS) });
    const [slot] = await fixture.schedule.scheduleSlot(at(DAY_MS));
    const id = slot?.id ?? '';
    const restore = () => fixture.schedule.restoreSlot({ clientId: BASE.clientId, slotIds: [id], actorUserId: 'head-1', restorableReasons: HOST_REASONS });
    expect(await refusal(restore())).toBe('SLOT_NOT_RESTORABLE');
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: id, actorUserId: 'head-1', reason: 'duplicate' });
    expect(await refusal(restore())).toBe('SLOT_NOT_RESTORABLE');
    const [other] = await fixture.schedule.scheduleSlot(at(2 * DAY_MS));
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: other?.id ?? '', actorUserId: 'head-1', reason: 'absence' });
    await fixture.schedule.scheduleSlot(at(2 * DAY_MS + HOUR_MS));
    expect(await refusal(fixture.schedule.restoreSlot({ clientId: BASE.clientId, slotIds: [other?.id ?? ''], actorUserId: 'head-1', restorableReasons: HOST_REASONS }))).toBe('SLOT_OVERLAP');
    fixture.setNow(new Date(NOW.getTime() + 3 * DAY_MS));
    expect(await refusal(fixture.schedule.restoreSlot({ clientId: BASE.clientId, slotIds: [other?.id ?? ''], actorUserId: 'head-1', restorableReasons: HOST_REASONS }))).toBe('SLOT_OVER');
  });
});

describe('revertScheduleChange', () => {
  it('undoes a series create, and the extension builds nothing for it afterwards', async () => {
    const fixture = await withSeries();
    await fixture.schedule.extendSeries(new Date(NOW.getTime() + 2 * DAY_MS));
    expect(fixture.live()).toHaveLength(5);
    await fixture.revert(fixture.created);
    expect(fixture.live()).toEqual([]);
    expect(new Set(fixture.db.slots().map((slot) => slot.cancelReason))).toEqual(new Set(['undo']));
    expect(fixture.db.series()[0]?.endsOn).toBe('2026-10-20');
    await fixture.schedule.extendSeries(new Date(NOW.getTime() + 9 * DAY_MS));
    expect(fixture.live()).toEqual([]);
  });

  it('undoes a promote: the rule retired, the singles back', async () => {
    const fixture = setup({ horizonWeeks: 2 });
    const [single] = await fixture.schedule.scheduleSlot({ ...BASE, startsAt: new Date('2026-10-21T13:00:00.000Z'), endsAt: new Date('2026-10-21T17:00:00.000Z') });
    const { change } = await fixture.schedule.promoteToSeries({ clientId: BASE.clientId, slotIds: [single?.id ?? ''], actorUserId: 'head-1', rule: { everyWeeks: 1, timeZone: SP } });
    await fixture.schedule.revertScheduleChange({ clientId: BASE.clientId, change, actorUserId: 'head-1' });
    expect(fixture.live().map((slot) => slot.id)).toEqual([single?.id]);
  });

  it('undoes a demote: the rule reopened, its days and the kept row back in it', async () => {
    const fixture = await withSeries();
    const before = schedule(fixture);
    const { change } = await fixture.schedule.demoteToSlot({ clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', keepDate: '2026-10-26', actorUserId: 'head-1' });
    await fixture.revert(change);
    expect(schedule(fixture)).toEqual(before);
    expect(fixture.db.series()[0]?.endsOn).toBeNull();
    expect(fixture.live().every((slot) => slot.seriesId === fixture.series?.id && !slot.detached)).toBe(true);
  });

  it('undoes a series edit: the successor retired, the old rule and its rows back', async () => {
    const fixture = await withSeries();
    const before = schedule(fixture);
    const { change } = await fixture.schedule.editSeries({ clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', actorUserId: 'head-1', from: '2026-10-26', patch: { weekdays: [2, 4] } });
    await fixture.revert(change);
    expect(schedule(fixture)).toEqual(before);
    expect(fixture.db.series().map((rule) => rule.endsOn)).toEqual([null, '2026-10-25']);
  });

  it('undoes a following cancel, and an in-place edit', async () => {
    const fixture = await withSeries();
    const before = schedule(fixture);
    const canceled = await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: fixture.rows[1]?.id ?? '', actorUserId: 'head-1', scope: 'following' });
    await fixture.revert(canceled.change);
    expect(schedule(fixture)).toEqual(before);
    expect(fixture.db.series()[0]).toMatchObject({ endsOn: null, canceledFrom: null });
    const edited = await fixture.schedule.editSlot({ clientId: BASE.clientId, slotId: fixture.rows[0]?.id ?? '', actorUserId: 'head-1', patch: { userId: 'nurse-2' } });
    await fixture.revert(edited.change);
    expect(fixture.live().find((slot) => slot.id === fixture.rows[0]?.id)).toMatchObject({ userId: BASE.userId, seriesId: fixture.series?.id, originSeriesId: null });
  });

  it('refuses when a row it would touch changed since, and changes nothing', async () => {
    const fixture = await withSeries();
    await fixture.schedule.editSlot({ clientId: BASE.clientId, slotId: fixture.rows[2]?.id ?? '', actorUserId: 'head-1', patch: { startMinutes: 11 * 60 } });
    const before = schedule(fixture);
    expect(await refusal(fixture.revert(fixture.created))).toBe('SCHEDULE_CHANGED');
    expect(schedule(fixture)).toEqual(before);
    const tampered = { ...fixture.created, createdSlotIds: ['not-a-slot'] };
    expect(await refusal(fixture.revert(tampered))).toBe('SCHEDULE_CHANGED');
  });
});

describe('every write audits', () => {
  it('writes an audit row for each kind of write, under the resource it changed', async () => {
    const fixture = await withSeries();
    const id = (n: number) => fixture.rows[n]?.id ?? '';
    const edited = await fixture.schedule.editSlot({ clientId: BASE.clientId, slotId: id(0), actorUserId: 'head-1', patch: { endMinutes: 15 * 60 } });
    await fixture.revert(edited.change);
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: id(1), actorUserId: 'head-1', reason: 'store' });
    await fixture.schedule.restoreSlot({ clientId: BASE.clientId, slotIds: [id(1)], actorUserId: 'head-1', restorableReasons: HOST_REASONS });
    await fixture.schedule.editSeries({ clientId: BASE.clientId, seriesId: fixture.series?.id ?? '', actorUserId: 'head-1', from: '2026-10-28', patch: { endMinutes: 13 * 60 } });
    const [single] = await fixture.schedule.scheduleSlot({ ...BASE, userId: 'nurse-2', startsAt: new Date('2026-10-23T13:00:00.000Z'), endsAt: new Date('2026-10-23T15:00:00.000Z') });
    const promoted = await fixture.schedule.promoteToSeries({ clientId: BASE.clientId, slotIds: [single?.id ?? ''], actorUserId: 'head-1', rule: { everyWeeks: 2, timeZone: SP } });
    await fixture.schedule.demoteToSlot({ clientId: BASE.clientId, seriesId: promoted.series?.id ?? '', keepDate: '2026-10-23', actorUserId: 'head-1' });
    const seen = new Set(fixture.db.audits().map((audit) => `${audit.action} ${audit.resourceType}`));
    expect([...seen].sort()).toEqual(
      [
        'shift.schedule shift_slot',
        'shift.schedule.cancel shift_slot',
        'shift.schedule.demote shift_slot',
        'shift.schedule.demote shift_slot_series',
        'shift.schedule.edit shift_slot',
        'shift.schedule.promote shift_slot',
        'shift.schedule.promote shift_slot_series',
        'shift.schedule.restore shift_slot',
        'shift.schedule.series shift_slot_series',
      ].sort(),
    );
    expect(fixture.db.audits().every((audit) => audit.actorUserId === 'head-1')).toBe(true);
  });
});
