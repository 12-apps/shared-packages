import { describe, expect, it } from 'vitest';

import {
  ShiftConfigError,
  ShiftScheduleError,
  createMemoryShiftScheduleDb,
  createShiftScheduleService,
  type Shift,
  type ShiftSlot,
} from '../index';

/**
 * The vocabulary is a CLINIC's, not this package's: nurses work a `ward` shift
 * or a `triage` shift. A fixture that reads like one on purpose.
 */
const KINDS = ['ward', 'triage'] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const NOW_ISO = '2026-10-20T12:00:00.000Z';
const NOW = new Date(NOW_ISO);

function at(offsetMs: number): Date {
  return new Date(Date.parse(NOW_ISO) + offsetMs);
}

function setup(now: () => Date = () => NOW) {
  const ids = { n: 0 };
  const db = createMemoryShiftScheduleDb();
  const schedule = createShiftScheduleService(db, {
    kinds: KINDS,
    now,
    createId: () => `id-${++ids.n}`,
  });
  return { db, schedule };
}

const BASE = {
  clientId: 'clinic-a',
  userId: 'nurse-1',
  kind: 'ward' as const,
  actorUserId: 'head-1',
};

function slotAt(startOffset: number, hours = 4) {
  return { ...BASE, startsAt: at(startOffset), endsAt: at(startOffset + hours * HOUR_MS) };
}

async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ShiftScheduleError);
  return (error as ShiftScheduleError).code;
}

describe('scheduleSlot', () => {
  it('creates one slot and audits it', async () => {
    const fixture = setup();
    const [slot] = await fixture.schedule.scheduleSlot(slotAt(DAY_MS));
    expect(slot).toMatchObject({
      clientId: BASE.clientId,
      userId: BASE.userId,
      kind: BASE.kind,
      createdByUserId: BASE.actorUserId,
      seriesId: null,
      canceledAt: null,
    });
    expect(fixture.db.audits()).toEqual([
      expect.objectContaining({ action: 'shift.schedule', resourceId: slot?.id, actorUserId: 'head-1' }),
    ]);
  });

  it.each([
    ['an unknown kind', { kind: 'cleaning' }],
    ['an end before the start', { endsAt: at(DAY_MS - HOUR_MS) }],
    ['a slot longer than a day', { endsAt: at(2 * DAY_MS + MINUTE_MS) }],
    ['a start in the past', { startsAt: at(-HOUR_MS), endsAt: at(HOUR_MS) }],
    ['a repeat with no time zone', { repeatWeeks: 2 }],
    ['an unknown time zone', { repeatWeeks: 2, timeZone: 'Mars/Olympus' }],
    ['too many repeats', { repeatWeeks: 13, timeZone: 'UTC' }],
    ['a fractional repeat', { repeatWeeks: 1.5, timeZone: 'UTC' }],
  ])('refuses %s', async (_, override) => {
    const fixture = setup();
    const input = { ...slotAt(DAY_MS), ...override } as Parameters<typeof fixture.schedule.scheduleSlot>[0];
    expect(await refusal(fixture.schedule.scheduleSlot(input))).toBe('INVALID_SLOT');
    expect(fixture.db.slots()).toEqual([]);
  });

  it('repeats weekly in one series, oldest first', async () => {
    const fixture = setup();
    const slots = await fixture.schedule.scheduleSlot({ ...slotAt(DAY_MS), repeatWeeks: 2, timeZone: 'UTC' });
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      at(DAY_MS).toISOString(),
      at(8 * DAY_MS).toISOString(),
      at(15 * DAY_MS).toISOString(),
    ]);
    expect(new Set(slots.map((slot) => slot.seriesId)).size).toBe(1);
    expect(slots[0]?.seriesId).not.toBeNull();
  });

  it('keeps the wall-clock time across a daylight-saving change', async () => {
    // New York leaves daylight time on 2026-11-01: 09:00 is 13:00Z before, 14:00Z after.
    const fixture = setup();
    const slots = await fixture.schedule.scheduleSlot({
      ...BASE,
      startsAt: new Date('2026-10-26T13:00:00.000Z'),
      endsAt: new Date('2026-10-26T17:00:00.000Z'),
      repeatWeeks: 1,
      timeZone: 'America/New_York',
    });
    expect(slots[1]?.startsAt.toISOString()).toBe('2026-11-02T14:00:00.000Z');
    expect(slots[1]?.endsAt.toISOString()).toBe('2026-11-02T18:00:00.000Z');
  });

  it('refuses an overlap with a live slot, all or nothing across the repeats', async () => {
    const fixture = setup();
    await fixture.schedule.scheduleSlot(slotAt(8 * DAY_MS + HOUR_MS));
    const code = await refusal(fixture.schedule.scheduleSlot({ ...slotAt(DAY_MS), repeatWeeks: 2, timeZone: 'UTC' }));
    expect(code).toBe('SLOT_OVERLAP');
    expect(fixture.db.slots()).toHaveLength(1);
  });

  it('lets a canceled slot be scheduled over, and the same person in another tenant at the same time', async () => {
    const fixture = setup();
    const [first] = await fixture.schedule.scheduleSlot(slotAt(DAY_MS));
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: first?.id ?? '', actorUserId: 'head-1' });
    await expect(fixture.schedule.scheduleSlot(slotAt(DAY_MS))).resolves.toHaveLength(1);
    await expect(fixture.schedule.scheduleSlot({ ...slotAt(DAY_MS), clientId: 'clinic-b' })).resolves.toHaveLength(1);
  });

  it('accepts twelve repeats and refuses a negative count', async () => {
    const fixture = setup();
    const slots = await fixture.schedule.scheduleSlot({ ...slotAt(DAY_MS), repeatWeeks: 12, timeZone: 'UTC' });
    expect(slots).toHaveLength(13);
    const negative = { ...slotAt(DAY_MS), repeatWeeks: -1, timeZone: 'UTC' };
    expect(await refusal(fixture.schedule.scheduleSlot(negative))).toBe('INVALID_SLOT');
  });

  it('lets exactly one of two concurrent identical writes in', async () => {
    const fixture = setup();
    const results = await Promise.allSettled([
      fixture.schedule.scheduleSlot(slotAt(DAY_MS)),
      fixture.schedule.scheduleSlot(slotAt(DAY_MS + HOUR_MS)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(fixture.db.slots()).toHaveLength(1);
  });

  it('refuses a bad configuration up front', () => {
    const db = createMemoryShiftScheduleDb();
    expect(() => createShiftScheduleService(db, { kinds: KINDS, maxRepeatWeeks: -1 })).toThrow(ShiftConfigError);
    expect(() => createShiftScheduleService(db, { kinds: KINDS, dueWindowMinutes: Number.NaN })).toThrow(
      ShiftConfigError,
    );
  });

  it('allows back-to-back slots', async () => {
    const fixture = setup();
    await fixture.schedule.scheduleSlot(slotAt(DAY_MS, 4));
    await expect(fixture.schedule.scheduleSlot(slotAt(DAY_MS + 4 * HOUR_MS, 4))).resolves.toHaveLength(1);
  });
});

describe('cancelSlot', () => {
  async function series() {
    const ctx = setup();
    const slots = await ctx.schedule.scheduleSlot({ ...slotAt(DAY_MS), repeatWeeks: 3, timeZone: 'UTC' });
    return { ...ctx, slots };
  }

  it('cancels one slot with who and why', async () => {
    const fixture = await series();
    const { slots } = fixture;
    const canceled = await fixture.schedule.cancelSlot({
      clientId: BASE.clientId,
      slotId: slots[1]?.id ?? '',
      actorUserId: 'head-1',
      reason: 'absence',
    });
    expect(canceled).toEqual([
      expect.objectContaining({ id: slots[1]?.id, canceledByUserId: 'head-1', cancelReason: 'absence', canceledAt: NOW }),
    ]);
  });

  it('cancels this and the following live slots of the series, not the earlier ones', async () => {
    const fixture = await series();
    const { slots } = fixture;
    const canceled = await fixture.schedule.cancelSlot({
      clientId: BASE.clientId,
      slotId: slots[1]?.id ?? '',
      actorUserId: 'head-1',
      scope: 'following',
    });
    expect(canceled.map((slot) => slot.id).sort()).toEqual([slots[1]?.id, slots[2]?.id, slots[3]?.id].sort());
    const live = await fixture.schedule.listSlots({ clientId: BASE.clientId, from: NOW, to: at(60 * DAY_MS) });
    expect(live.map((slot) => slot.id)).toEqual([slots[0]?.id]);
  });

  it('cancels only the slot itself when it has no series, and audits the cancel', async () => {
    const fixture = setup();
    const [slot] = await fixture.schedule.scheduleSlot(slotAt(DAY_MS));
    const canceled = await fixture.schedule.cancelSlot({
      clientId: BASE.clientId,
      slotId: slot?.id ?? '',
      actorUserId: 'head-1',
      scope: 'following',
    });
    expect(canceled.map((one) => one.id)).toEqual([slot?.id]);
    expect(fixture.db.audits().at(-1)).toMatchObject({ action: 'shift.schedule.cancel', resourceId: slot?.id });
  });

  it('lets one of two concurrent cancels win and refuses the other', async () => {
    const fixture = setup();
    const [slot] = await fixture.schedule.scheduleSlot(slotAt(DAY_MS));
    const cancel = { clientId: BASE.clientId, slotId: slot?.id ?? '', actorUserId: 'head-1' };
    const [first, second] = await Promise.allSettled([
      fixture.schedule.cancelSlot(cancel),
      fixture.schedule.cancelSlot(cancel),
    ]);
    expect(first?.status).toBe('fulfilled');
    expect(second?.status === 'rejected' && (second.reason as ShiftScheduleError).code).toBe('SLOT_CANCELED');
  });

  it('refuses another tenant, a canceled slot and a slot already over', async () => {
    const clock = { now: NOW };
    const fixture = setup(() => clock.now);
    const [slot] = await fixture.schedule.scheduleSlot(slotAt(DAY_MS));
    const id = slot?.id ?? '';
    expect(await refusal(fixture.schedule.cancelSlot({ clientId: 'clinic-b', slotId: id, actorUserId: null }))).toBe(
      'SLOT_NOT_FOUND',
    );
    clock.now = at(DAY_MS + 5 * HOUR_MS);
    expect(await refusal(fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: id, actorUserId: null }))).toBe(
      'SLOT_OVER',
    );
    clock.now = NOW;
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: id, actorUserId: null });
    expect(await refusal(fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: id, actorUserId: null }))).toBe(
      'SLOT_CANCELED',
    );
  });
});

describe('reads', () => {
  it('lists live slots in a window, and canceled ones only when asked', async () => {
    const fixture = setup();
    const [kept] = await fixture.schedule.scheduleSlot(slotAt(DAY_MS));
    const [dropped] = await fixture.schedule.scheduleSlot(slotAt(2 * DAY_MS));
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: dropped?.id ?? '', actorUserId: 'head-1', reason: 'absence' });
    const window = { clientId: BASE.clientId, from: NOW, to: at(3 * DAY_MS) };
    expect((await fixture.schedule.listSlots(window)).map((slot) => slot.id)).toEqual([kept?.id]);
    const all = await fixture.schedule.listSlots({ ...window, includeCanceled: true });
    expect(all.map((slot) => slot.cancelReason)).toEqual([null, 'absence']);
  });

  it('reads a slot under way as next, and never an over or canceled one', async () => {
    const clock = { now: NOW };
    const fixture = setup(() => clock.now);
    const [running] = await fixture.schedule.scheduleSlot(slotAt(HOUR_MS));
    await fixture.schedule.scheduleSlot(slotAt(-10 * HOUR_MS + DAY_MS, 1));
    const [dropped] = await fixture.schedule.scheduleSlot(slotAt(2 * DAY_MS));
    await fixture.schedule.cancelSlot({ clientId: BASE.clientId, slotId: dropped?.id ?? '', actorUserId: null });
    clock.now = at(DAY_MS - 8 * HOUR_MS);
    const next = await fixture.schedule.nextSlots({ clientIds: [BASE.clientId], userId: BASE.userId, limit: 5 });
    expect(next).toEqual([]);
    clock.now = at(2 * HOUR_MS);
    const during = await fixture.schedule.nextSlots({ clientIds: [BASE.clientId], userId: BASE.userId, limit: 5 });
    expect(during[0]?.id).toBe(running?.id);
  });

  it('reads the next slots only in the tenants allowed, filtering before the limit', async () => {
    const fixture = setup();
    await fixture.schedule.scheduleSlot({ ...slotAt(DAY_MS), clientId: 'clinic-gone' });
    await fixture.schedule.scheduleSlot({ ...slotAt(2 * DAY_MS), clientId: 'clinic-b' });
    await fixture.schedule.scheduleSlot(slotAt(3 * DAY_MS));
    const next = await fixture.schedule.nextSlots({ clientIds: ['clinic-a', 'clinic-b'], userId: BASE.userId, limit: 2 });
    expect(next.map((slot) => slot.clientId)).toEqual(['clinic-b', 'clinic-a']);
    expect(await refusal(fixture.schedule.nextSlots({ clientIds: [], userId: BASE.userId, limit: 2 }))).toBe('INVALID_SLOT');
  });
});

describe('slotStanding', () => {
  const START = at(DAY_MS);
  const SLOT: ShiftSlot = {
    id: 's',
    clientId: 'clinic-a',
    userId: 'nurse-1',
    kind: 'ward',
    startsAt: START,
    endsAt: new Date(START.getTime() + 4 * HOUR_MS),
    resourceType: null,
    resourceId: null,
    coverage: null,
    seriesId: null,
    createdByUserId: 'head-1',
    createdAt: NOW,
    canceledAt: null,
    canceledByUserId: null,
    cancelReason: null,
  };
  const OPEN = { id: 'shift' } as Shift;
  const standing = (offsetFromStart: number, openShift: Shift | null = null, slot = SLOT) =>
    setup().schedule.slotStanding({ slot, openShift, now: new Date(START.getTime() + offsetFromStart) });

  it.each([
    ['later, just outside the window', -16 * MINUTE_MS, null, 'later', 0],
    ['due, at the window', -15 * MINUTE_MS, null, 'due', 0],
    ['late, at the start', 0, null, 'late', 0],
    ['late, with its minutes', 12 * MINUTE_MS + 30_000, null, 'late', 12],
    ['on shift, early inside the window', -10 * MINUTE_MS, OPEN, 'on_shift', 0],
    ['on shift, under way', HOUR_MS, OPEN, 'on_shift', 0],
    ['later, even with an open shift before the window', -HOUR_MS, OPEN, 'later', 0],
    ['on shift, exactly at the window', -15 * MINUTE_MS, OPEN, 'on_shift', 0],
    ['late, a millisecond before the end', 4 * HOUR_MS - 1, null, 'late', 239],
    ['over, at the end', 4 * HOUR_MS, null, 'over', 0],
    ['over, even with an open shift', 4 * HOUR_MS, OPEN, 'over', 0],
  ])('%s', (_, offset, open, expected, minutes) => {
    expect(standing(offset, open)).toEqual({ standing: expected, lateMinutes: minutes });
  });

  it('reads an undefined open shift as none', () => {
    const undefinedShift = undefined as unknown as Shift | null;
    expect(standing(HOUR_MS, undefinedShift)).toEqual({ standing: 'late', lateMinutes: 60 });
  });

  it('is canceled before anything else', () => {
    expect(standing(HOUR_MS, OPEN, { ...SLOT, canceledAt: NOW })).toEqual({ standing: 'canceled', lateMinutes: 0 });
  });
});
