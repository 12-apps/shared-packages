import { describe, expect, it } from 'vitest';

import { ShiftError, createMemoryShiftDb, createShiftService } from '../index';

/**
 * A HOST's vocabulary, and deliberately not the one this package was extracted
 * from: the fixtures roster a clinic. Through 3.x they could not have — the
 * kinds were a `'kitchen' | 'service'` union the package exported and
 * validated against, so the only shifts its own tests could open were that one
 * application's. That the suite now reads `ward` and `reception` end to end,
 * with nothing imported from `../index` to say so, IS the portability claim.
 */
const WARD_RESOURCE_TYPE = 'ward';
const SHIFT_KINDS = ['ward', 'reception'] as const;

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
    kinds: SHIFT_KINDS,
    now,
    createId: () => `id-${++ids.sequence}`,
  });
  return { db, service };
}

function setup() {
  return setupAt(() => START);
}

describe('shift service', () => {
  it('takes its kind set from the host and refuses one outside it', async () => {
    const fixture = setup();

    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-a',
        // A kind from the application this package was extracted for. It was a
        // member of the exported union through 3.x; here it is just a string no
        // host configured, which is the whole of the change.
        kind: 'kitchen',
        actorUserId: 'nurse-a',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
    expect(fixture.db.snapshot().shifts).toHaveLength(0);

    // The message names the configured set: the failure a host really hits is a
    // typo or a kind it forgot to declare, and neither reads off the value.
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-a',
        kind: 'kitchen',
        actorUserId: 'nurse-a',
      }),
    ).rejects.toThrow(/Configured kinds: ward, reception/);
  });

  it('refuses to assemble without a kind set, at the wiring line', () => {
    const db = createMemoryShiftDb();

    // Not a ShiftError: those carry a code a host maps onto an HTTP response,
    // and a missing option is not a request outcome. Thrown at assembly rather
    // than on first use, so the stack points at the line that wired it.
    expect(() => createShiftService(db, { kinds: [] })).toThrow(/must name at least one shift kind/);
    expect(() => createShiftService(db, { kinds: ['  '] })).toThrow(
      /must name at least one shift kind/,
    );
  });

  it('opens an assignment, shift and audit event in one transaction', async () => {
    const fixture = setup();

    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
      resource: {
        type: WARD_RESOURCE_TYPE,
        id: 'bay-1',
      },
    });

    expect(shift).toMatchObject({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward',
      // Equal to the `ward:*` action namespace a host's RBAC point check
      // derives its resource type from — not the admin CRUD surface's name.
      resourceType: 'ward',
      resourceId: 'bay-1',
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
        actorUserId: 'nurse-a',
      }),
    ]);
  });

  it('rejects a second open shift for the same tenant and user', async () => {
    const fixture = setup();
    const input = {
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward' as const,
      actorUserId: 'nurse-a',
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
        userId: 'nurse-a',
        kind: 'payroll' as never,
        actorUserId: 'nurse-a',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SHIFT' });
  });

  it('allows several workers on one station unless the caller requests exclusivity', async () => {
    const fixture = setup();
    const resource = { type: WARD_RESOURCE_TYPE, id: 'bay-1' };

    await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
      resource,
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-b',
        kind: 'ward',
        actorUserId: 'nurse-b',
        resource,
      }),
    ).resolves.toMatchObject({ resourceId: 'bay-1' });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-c',
        kind: 'ward',
        actorUserId: 'nurse-c',
        resource: { ...resource, exclusive: true },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });
  });

  it('treats a still-unreleased exclusive claim as occupied, whenever it starts', async () => {
    const fixture = setup();
    const resource = {
      type: WARD_RESOURCE_TYPE,
      id: 'bay-1',
      exclusive: true as const,
    };
    // A claim that has not been released occupies the station even though it
    // is dated to begin AFTER this open — the scheduled incumbent keeps it.
    fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'nurse-z',
      resourceType: WARD_RESOURCE_TYPE,
      resourceId: 'bay-1',
      validFrom: new Date('2026-07-30T12:00:00.000Z'),
      validTo: null,
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-a',
        kind: 'ward',
        actorUserId: 'nurse-a',
        resource,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });

    // Released before this open: free.
    fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'nurse-y',
      resourceType: WARD_RESOURCE_TYPE,
      resourceId: 'fryer',
      validFrom: new Date('2026-07-29T00:00:00.000Z'),
      validTo: new Date('2026-07-30T09:00:00.000Z'),
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-b',
        kind: 'ward',
        actorUserId: 'nurse-b',
        resource: { ...resource, id: 'fryer' },
      }),
    ).resolves.toMatchObject({ resourceId: 'fryer' });

    // Released only later: still occupied.
    fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'nurse-x',
      resourceType: WARD_RESOURCE_TYPE,
      resourceId: 'oven',
      validFrom: new Date('2026-07-29T00:00:00.000Z'),
      validTo: new Date('2026-07-31T00:00:00.000Z'),
    });
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-c',
        kind: 'ward',
        actorUserId: 'nurse-c',
        resource: { ...resource, id: 'oven' },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_TAKEN' });
  });

  it('judges exclusivity at max(startedAt, now), so backdating cannot free a station', async () => {
    const fixture = setup();
    const resource = {
      type: WARD_RESOURCE_TYPE,
      id: 'bay-1',
      exclusive: true as const,
    };
    await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
      resource,
    });

    // Backdated to before the incumbent's claim began. The station is occupied
    // NOW, which is the only moment that can matter.
    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-b',
        kind: 'ward',
        actorUserId: 'nurse-b',
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
      userId: 'nurse-a',
      kind: 'ward' as const,
      actorUserId: 'nurse-a',
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
    ).resolves.toMatchObject({ userId: 'nurse-a' });
    await expect(
      fixture.service.openShift({
        ...base,
        userId: 'nurse-b',
        actorUserId: 'nurse-b',
        startedAt: fromStart(-2 * HOUR_MS),
      }),
    ).resolves.toMatchObject({ userId: 'nurse-b' });
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
        userId: 'nurse-a',
        kind: 'ward',
        actorUserId: 'nurse-a',
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
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
      resource: { type: WARD_RESOURCE_TYPE, id: 'bay-1' },
    });
    const unrelatedId = fixture.db.seedAssignment({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      resourceType: WARD_RESOURCE_TYPE,
      resourceId: 'fryer',
      validFrom: START,
    });
    const endedAt = new Date('2026-07-30T18:00:00.000Z');

    const closed = await fixture.service.closeOwnShift({
      clientId: 'tenant-a',
      shiftId: shift.id,
      userId: 'nurse-a',
      endedAt,
    });

    expect(closed).toMatchObject({
      endedAt,
      endedReason: 'user',
      endedByUserId: 'nurse-a',
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
      actorUserId: 'nurse-a',
    });
  });

  it('rolls back all open and close writes when audit persistence fails', async () => {
    const fixture = setup();
    fixture.db.failNext('audit');

    await expect(
      fixture.service.openShift({
        clientId: 'tenant-a',
        userId: 'nurse-a',
        kind: 'ward',
        actorUserId: 'nurse-a',
        resource: { type: WARD_RESOURCE_TYPE, id: 'bay-1' },
      }),
    ).rejects.toThrow('injected audit failure');
    expect(fixture.db.snapshot()).toMatchObject({
      shifts: [],
      assignments: [],
      audits: [],
    });

    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
      resource: { type: WARD_RESOURCE_TYPE, id: 'bay-1' },
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
        userId: 'nurse-a',
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
      userId: 'cook',
      kind: 'ward',
      actorUserId: 'cook',
    });
    await fixture.service.openShift({
      clientId: 'tenant-b',
      userId: 'cook',
      kind: 'reception',
      actorUserId: 'cook',
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
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
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
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
      resource: { type: WARD_RESOURCE_TYPE, id: 'bay-1' },
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
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
    });
    const healthy = await fixture.service.openShift({
      clientId: 'tenant-ok',
      userId: 'nurse-b',
      kind: 'ward',
      actorUserId: 'nurse-b',
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
        userId: 'nurse-a',
      }),
    ).toMatchObject({ id: poisoned.id, endedAt: null });
  });

  it('reports a non-ShiftError sweep failure without losing the pass', async () => {
    const clock = { now: new Date('2026-07-30T00:00:00.000Z') };
    const fixture = setupAt(() => clock.now);
    const shift = await fixture.service.openShift({
      clientId: 'tenant-a',
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
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
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
    });

    await expect(
      fixture.service.closeOwnShift({
        clientId: 'tenant-a',
        shiftId: shift.id,
        userId: 'nurse-b',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_OWNED' });
    expect(
      await fixture.service.getOpenShift({
        clientId: 'tenant-a',
        userId: 'nurse-a',
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
      userId: 'nurse-a',
      kind: 'ward',
      actorUserId: 'nurse-a',
    });
    await fixture.service.closeOwnShift({
      clientId: 'tenant-a',
      shiftId: shift.id,
      userId: 'nurse-a',
    });

    await expect(
      fixture.service.closeOwnShift({
        clientId: 'tenant-a',
        shiftId: shift.id,
        userId: 'nurse-a',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_ALREADY_ENDED' });
  });
});
