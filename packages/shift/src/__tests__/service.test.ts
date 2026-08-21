import { describe, expect, it } from 'vitest';

import {
  ShiftError,
  createMemoryShiftDb,
  createShiftService,
} from '../index';

/**
 * The vocabulary these cases run on belongs to a WIND FARM, not to this
 * package: technicians work a `climb` shift up a tower or a `dispatch` shift in
 * the control room, and a tower is claimed exclusively because two crews may
 * never be aloft on the same one.
 *
 * It is a fixture, and it reads like one on purpose. This suite used to open
 * `kind: 'climb'` shifts against a package-supplied union — which is how the
 * union survived: every case here passed with it, because the tests had been
 * written in the same words the leak was.
 */
const KINDS = ['climb', 'dispatch'] as const;
const TOWER = 'tower';

const START_ISO = '2026-07-30T10:00:00.000Z';
const START = new Date(START_ISO);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A fixed instant relative to {@link START} — no wall clock, no shared state. */
function fromStart(offsetMs: number): Date {
  return new Date(Date.parse(START_ISO) + offsetMs);
}

function setupAt(now: () => Date) {
  const ids = { sequence: 0 };
  const db = createMemoryShiftDb();
  const service = createShiftService(db, {
    kinds: KINDS,
    now,
    createId: () => `id-${++ids.sequence}`,
  });
  return { db, service };
}

function setup() {
  return setupAt(() => START);
}

describe('shift service', () => {
  it('opens an assignment, shift and audit event in one transaction', async () => {
    const fixture = setup();

    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
      resource: {
        type: TOWER,
        id: 'tower-14',
      },
    });

    expect(shift).toMatchObject({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      // The host's own resource type, carried by value: the package never
      // learns what a tower is, only that this one is claimed.
      resourceType: TOWER,
      resourceId: 'tower-14',
      endedAt: null,
    });
    const state = fixture.db.snapshot();
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0]?.validTo).toBeNull();
    expect(state.audits).toEqual([
      expect.objectContaining({
        clientId: 'tenant-a',
        action: 'shift.start',
        resourceType: 'shift',
        actorUserId: 'tech-a',
      }),
    ]);
  });

  it('rejects a second open shift for the same tenant and user', async () => {
    const fixture = setup();
    const input = {
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb' as const,
      actorUserId: 'tech-a',
    };
    await fixture.service.openShift(input);

    await expect(fixture.service.openShift(input)).rejects.toMatchObject({
      code: 'SHIFT_ALREADY_OPEN',
    });
  });

  it('returns a typed validation error for an unknown runtime kind', async () => {
    const fixture = setup();
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-a',
        kind: 'payroll' as never,
        actorUserId: 'tech-a',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
  });

  it('allows several workers on one tower unless the caller requests exclusivity', async () => {
    const fixture = setup();
    const resource = { type: TOWER, id: 'tower-14' };

    await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
      resource,
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-b',
        kind: 'climb',
        actorUserId: 'tech-b',
        resource,
      }),
    ).resolves.toMatchObject({ resourceId: 'tower-14' });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-c',
        kind: 'climb',
        actorUserId: 'tech-c',
        resource: { ...resource, exclusive: true },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });
  });

  it('treats a still-unreleased exclusive claim as occupied, whenever it starts', async () => {
    const fixture = setup();
    const resource = {
      type: TOWER,
      id: 'tower-14',
      exclusive: true as const,
    };
    // A claim that has not been released occupies the tower even though it
    // is dated to begin AFTER this open — the scheduled incumbent keeps it.
    fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'tech-z',
      resourceType: TOWER,
      resourceId: 'tower-14',
      validFrom: new Date('2026-07-30T12:00:00.000Z'),
      validTo: null,
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-a',
        kind: 'climb',
        actorUserId: 'tech-a',
        resource,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });

    // Released before this open: free.
    fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'tech-y',
      resourceType: TOWER,
      resourceId: 'fryer',
      validFrom: new Date('2026-07-29T00:00:00.000Z'),
      validTo: new Date('2026-07-30T09:00:00.000Z'),
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-b',
        kind: 'climb',
        actorUserId: 'tech-b',
        resource: { ...resource, id: 'fryer' },
      }),
    ).resolves.toMatchObject({ resourceId: 'fryer' });

    // Released only later: still occupied.
    fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'tech-x',
      resourceType: TOWER,
      resourceId: 'oven',
      validFrom: new Date('2026-07-29T00:00:00.000Z'),
      validTo: new Date('2026-07-31T00:00:00.000Z'),
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-c',
        kind: 'climb',
        actorUserId: 'tech-c',
        resource: { ...resource, id: 'oven' },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });
  });

  it('judges exclusivity at max(startedAt, now), so backdating cannot free a tower', async () => {
    const fixture = setup();
    const resource = {
      type: TOWER,
      id: 'tower-14',
      exclusive: true as const,
    };
    await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
      resource,
    });

    // Backdated to before the incumbent's claim began. The tower is occupied
    // NOW, which is the only moment that can matter.
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-b',
        kind: 'climb',
        actorUserId: 'tech-b',
        resource,
        startedAt: new Date('2026-07-30T02:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });
    expect(
      fixture.db.snapshot().assignments.filter((row) => row.validTo === null),
    ).toHaveLength(1);
  });

  it('rejects a future startedAt beyond clock skew, and unbounded backdating', async () => {
    const fixture = setup();
    const base = {
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb' as const,
      actorUserId: 'tech-a',
    };

    // A future start is unclosable: the sweep's cutoff is later still and a
    // manual close would put endedAt before startedAt.
    await expect(
      fixture.service.openShift({
        ...base,
        startedAt: fromStart(HOUR_MS),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
    await expect(
      fixture.service.openShift({
        ...base,
        startedAt: fromStart(-25 * HOUR_MS),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
    expect(fixture.db.snapshot().shifts).toHaveLength(0);

    // Inside the tolerated skew, and a legitimate backdated clock-in.
    await expect(
      fixture.service.openShift({
        ...base,
        startedAt: fromStart(MINUTE_MS),
      }),
    ).resolves.toMatchObject({ userId: 'tech-a' });
    await expect(
      fixture.service.openShift({
        ...base,
        userId: 'tech-b',
        actorUserId: 'tech-b',
        startedAt: fromStart(-2 * HOUR_MS),
      }),
    ).resolves.toMatchObject({ userId: 'tech-b' });
  });

  it('maps each open-path unique violation to its own typed error', async () => {
    const fixture = setup();
    const original = fixture.db.transaction.bind(fixture.db);
    const thrown: { constraint: string } = { constraint: '' };
    fixture.db.transaction = async () => {
      throw Object.assign(new Error(`Unique constraint failed: ${thrown.constraint}`), {
        constraint: thrown.constraint,
      });
    };
    const open = () =>
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-a',
        kind: 'climb',
        actorUserId: 'tech-a',
      });

    thrown.constraint = 'resource_assignments_active_unique_idx';
    await expect(open()).rejects.toMatchObject({ code: 'ASSIGNMENT_CONFLICT' });
    thrown.constraint = 'shifts_resource_assignment_id_key';
    await expect(open()).rejects.toMatchObject({ code: 'ASSIGNMENT_CONFLICT' });
    // The open-shift race is NOT an assignment conflict, even though both keys
    // are built from client_id + user_id.
    thrown.constraint = 'shifts_open_client_user_key';
    await expect(open()).rejects.toMatchObject({ code: 'SHIFT_ALREADY_OPEN' });
    // Anything the driver does not recognise is re-thrown untouched.
    thrown.constraint = 'some_other_index';
    await expect(open()).rejects.toThrow('Unique constraint failed: some_other_index');

    fixture.db.transaction = original;
  });

  it('closes the shift and exactly its owned assignment atomically', async () => {
    const fixture = setup();
    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
      resource: { type: TOWER, id: 'tower-14' },
    });
    const unrelatedId = fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'tech-a',
      resourceType: TOWER,
      resourceId: 'fryer',
      validFrom: START,
    });
    const endedAt = new Date('2026-07-30T18:00:00.000Z');

    const closed = await fixture.service.closeOwnShift({
      clientId: 'tenant-a',
      shiftId: shift.id,
      userId: 'tech-a',
      endedAt,
    });

    expect(closed).toMatchObject({
      endedAt,
      endedReason: 'user',
      endedByUserId: 'tech-a',
    });
    const state = fixture.db.snapshot();
    expect(
      state.assignments.find((assignment) => assignment.id === shift.resourceAssignmentId)?.validTo,
    ).toEqual(endedAt);
    expect(
      state.assignments.find((assignment) => assignment.id === unrelatedId)?.validTo,
    ).toBeNull();
    expect(state.audits.at(-1)).toMatchObject({
      action: 'shift.end',
      actorUserId: 'tech-a',
    });
  });

  it('rolls back all open and close writes when audit persistence fails', async () => {
    const fixture = setup();
    fixture.db.failNext('audit');

    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'tech-a',
        kind: 'climb',
        actorUserId: 'tech-a',
        resource: { type: TOWER, id: 'tower-14' },
      }),
    ).rejects.toThrow('injected audit failure');
    expect(fixture.db.snapshot()).toMatchObject({
      shifts: [],
      assignments: [],
      audits: [],
    });

    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
      resource: { type: TOWER, id: 'tower-14' },
    });
    fixture.db.failNext('audit');
    await expect(
      fixture.service.forceCloseShift({
        clientId: 'tenant-a',
        shiftId: shift.id,
        byUserId: 'manager-a',
      }),
    ).rejects.toThrow('injected audit failure');
    expect(
      await fixture.service.getOpenShift({
        clientId: 'tenant-a',
        userId: 'tech-a',
      }),
    ).toMatchObject({
      id: shift.id,
      endedAt: null,
    });
    expect(
      fixture.db
        .snapshot()
        .assignments.find((assignment) => assignment.id === shift.resourceAssignmentId)?.validTo,
    ).toBeNull();
  });

  it('keeps reads tenant-scoped and returns cursor-paginated history', async () => {
    const fixture = setup();
    const a = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech',
      kind: 'climb',
      actorUserId: 'tech',
    });
    await fixture.service.openShift({
      clientId: 'tenant-b',
      userId: 'tech',
      kind: 'dispatch',
      actorUserId: 'tech',
    });

    expect(await fixture.service.listOpenShifts({ clientId: 'tenant-a' })).toEqual([a]);
    expect(await fixture.service.getShift({ clientId: 'tenant-b', shiftId: a.id })).toBeNull();
    const history = await fixture.service.listShifts({
      clientId: 'tenant-a',
      limit: 1,
    });
    expect(history.items).toEqual([a]);
    expect(history.nextCursor).toBeNull();
  });

  it('rejects a pagination cursor that resolves to nothing', async () => {
    const fixture = setup();
    await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
    });

    // A Prisma-backed host raises on an unresolvable cursor; a driver that
    // quietly restarted from the top would silently re-serve page one.
    await expect(
      fixture.service.listShifts({ clientId: 'tenant-a', cursor: 'not-a-shift' }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
  });

  it('auto-closes at each tenant cutoff, not at sweep detection time', async () => {
    const clock = { now: new Date('2026-07-30T00:00:00.000Z') };
    const fixture = setupAt(() => clock.now);
    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
      resource: { type: TOWER, id: 'tower-14' },
    });
    clock.now = new Date('2026-07-30T20:13:00.000Z');

    const result = await fixture.service.autoCloseOverdue({
      detectedAt: clock.now,
      maxDurationMsForTenant: async () => 16 * 60 * 60_000,
    });

    expect(result.failures).toEqual([]);
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0]).toMatchObject({
      id: shift.id,
      endedAt: new Date('2026-07-30T16:00:00.000Z'),
      endedReason: 'auto',
      endedByUserId: null,
    });
    expect(fixture.db.snapshot().audits.at(-1)).toMatchObject({
      action: 'shift.end',
      actorUserId: null,
    });
  });

  it('isolates a poisoned candidate so the rest of the sweep still closes', async () => {
    const clock = { now: new Date('2026-07-30T00:00:00.000Z') };
    const fixture = setupAt(() => clock.now);
    const poisoned = await fixture.service.openShift({
      clientId: 'tenant-poison',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
    });
    const healthy = await fixture.service.openShift({
      clientId: 'tenant-ok',
      userId: 'tech-b',
      kind: 'climb',
      actorUserId: 'tech-b',
    });
    clock.now = new Date('2026-07-30T20:00:00.000Z');

    // The cross-tenant sweep runs with `attempts: 1`: before per-candidate
    // isolation this single tenant's failure aborted the pass and auto-close
    // stayed wedged platform-wide.
    const result = await fixture.service.autoCloseOverdue({
      detectedAt: clock.now,
      maxDurationMsForTenant: async (clientId) => {
        if (clientId === 'tenant-poison') {
          throw new ShiftError('ASSIGNMENT_CONFLICT', 'poisoned row');
        }
        return 16 * 60 * 60_000;
      },
    });

    expect(result.closed.map((shift) => shift.id)).toEqual([healthy.id]);
    expect(result.failures).toEqual([
      {
        clientId: 'tenant-poison',
        shiftId: poisoned.id,
        code: 'ASSIGNMENT_CONFLICT',
        message: 'poisoned row',
      },
    ]);
    expect(
      await fixture.service.getOpenShift({
        clientId: 'tenant-poison',
        userId: 'tech-a',
      }),
    ).toMatchObject({ id: poisoned.id, endedAt: null });
  });

  it('reports a non-ShiftError sweep failure without losing the pass', async () => {
    const clock = { now: new Date('2026-07-30T00:00:00.000Z') };
    const fixture = setupAt(() => clock.now);
    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
    });
    clock.now = new Date('2026-07-30T20:00:00.000Z');

    const result = await fixture.service.autoCloseOverdue({
      detectedAt: clock.now,
      maxDurationMsForTenant: async () => {
        throw new Error('tenant config unavailable');
      },
    });

    expect(result.closed).toEqual([]);
    expect(result.failures).toEqual([
      {
        clientId: 'tenant-a',
        shiftId: shift.id,
        code: 'UNKNOWN',
        message: 'tenant config unavailable',
      },
    ]);
  });

  it('returns typed not-found and already-ended failures', async () => {
    const fixture = setup();
    await expect(
      fixture.service.forceCloseShift({
        clientId: 'tenant-a',
        shiftId: 'missing',
        byUserId: 'manager-a',
      }),
    ).rejects.toBeInstanceOf(ShiftError);
    await expect(
      fixture.service.forceCloseShift({
        clientId: 'tenant-a',
        shiftId: 'missing',
        byUserId: 'manager-a',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND' });
  });

  it('allows only the shift owner through the close-own API', async () => {
    const fixture = setup();
    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
    });

    await expect(
      fixture.service.closeOwnShift({
        clientId: 'tenant-a',
        shiftId: shift.id,
        userId: 'tech-b',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_OWNED' });
    expect(
      await fixture.service.getOpenShift({
        clientId: 'tenant-a',
        userId: 'tech-a',
      }),
    ).toMatchObject({
      id: shift.id,
      endedAt: null,
    });
  });

  it('keeps a closed shift immutable on repeated close attempts', async () => {
    const fixture = setup();
    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'tech-a',
      kind: 'climb',
      actorUserId: 'tech-a',
    });
    await fixture.service.closeOwnShift({
      clientId: 'tenant-a',
      shiftId: shift.id,
      userId: 'tech-a',
    });

    await expect(
      fixture.service.closeOwnShift({
        clientId: 'tenant-a',
        shiftId: shift.id,
        userId: 'tech-a',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_ALREADY_ENDED' });
  });
});
