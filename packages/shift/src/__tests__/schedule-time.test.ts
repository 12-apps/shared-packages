import { describe, expect, it } from 'vitest';

import { ShiftScheduleError, createMemoryShiftScheduleDb, createShiftScheduleService } from '../index';
import { addZonedDays } from '../schedule-time';

const WEEK = 7;

describe('addZonedDays', () => {
  it.each([
    ['keeps 09:00 across a fall-back', '2026-10-26T13:00:00.000Z', 'America/New_York', '2026-11-02T14:00:00.000Z'],
    ['takes the first 01:30 of a repeated hour', '2026-10-25T05:30:00.000Z', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['pushes a skipped 02:30 past the gap, to 03:30', '2027-03-07T07:30:00.000Z', 'America/New_York', '2027-03-14T07:30:00.000Z'],
    ['does the same south of the equator', '2026-09-26T16:30:00.000Z', 'Australia/Sydney', '2026-10-03T16:30:00.000Z'],
    ['is plain arithmetic in UTC', '2026-10-21T09:00:00.000Z', 'UTC', '2026-10-28T09:00:00.000Z'],
  ])('%s', (_, from, zone, expected) => {
    expect(addZonedDays(new Date(from), WEEK, zone).toISOString()).toBe(expected);
  });
});

describe('repeats across a daylight-saving change', () => {
  function service() {
    return createShiftScheduleService(createMemoryShiftScheduleDb(), {
      kinds: ['ward'] as const,
      now: () => new Date('2026-10-20T12:00:00.000Z'),
    });
  }
  const BASE = { clientId: 'clinic-a', userId: 'nurse-1', kind: 'ward' as const, actorUserId: 'head-1' };

  it('refuses a 24-hour slot whose repeat would last 25 hours, and writes nothing', async () => {
    const schedule = service();
    const work = schedule.scheduleSlot({
      ...BASE,
      startsAt: new Date('2026-10-25T03:00:00.000Z'),
      endsAt: new Date('2026-10-26T03:00:00.000Z'),
      repeatWeeks: 1,
      timeZone: 'America/New_York',
    });
    const error = await work.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ShiftScheduleError);
    expect((error as ShiftScheduleError).code).toBe('INVALID_SLOT');
    const listed = await schedule.listSlots({
      clientId: BASE.clientId,
      from: new Date('2026-10-20T00:00:00.000Z'),
      to: new Date('2026-11-10T00:00:00.000Z'),
    });
    expect(listed).toEqual([]);
  });

  it('keeps start and end on the wall clock through a spring-forward', async () => {
    const [, second] = await service().scheduleSlot({
      ...BASE,
      startsAt: new Date('2027-03-07T07:30:00.000Z'),
      endsAt: new Date('2027-03-07T11:30:00.000Z'),
      repeatWeeks: 1,
      timeZone: 'America/New_York',
    });
    // 02:30 does not exist that day: 03:30 EDT, to 06:30 EDT.
    expect(second?.startsAt.toISOString()).toBe('2027-03-14T07:30:00.000Z');
    expect(second?.endsAt.toISOString()).toBe('2027-03-14T10:30:00.000Z');
  });
});
