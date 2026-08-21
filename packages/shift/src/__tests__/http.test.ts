import { describe, expect, it, vi } from 'vitest';

import { ShiftConfigError, ShiftError } from '../errors';
import {
  createApiShift,
  SHIFT_ERROR_STATUS,
  type ShiftHttpPort,
  type ShiftRoute,
} from '../http';
import type { Shift } from '../types';

/**
 * The three descriptors, driven the way a host adapter drives them: the
 * package owns the surface (paths, branches, envelope, error statuses), the
 * host owns the port, the guards and the wire shape — so every test binds a
 * fake port and the identity-revealing serializer a real host would pass.
 */

function storedShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    clientId: 't1',
    userId: 'u1',
    kind: 'kitchen',
    startedAt: new Date('2026-08-21T12:00:00Z'),
    endedAt: null,
    endedReason: null,
    endedByUserId: null,
    resourceAssignmentId: null,
    resourceType: null,
    resourceId: null,
    ...overrides,
  };
}

function fakePort(overrides: Partial<ShiftHttpPort> = {}): ShiftHttpPort {
  return {
    open: vi.fn().mockResolvedValue(storedShift()),
    closeOwn: vi.fn().mockResolvedValue(storedShift({ endedReason: 'user' })),
    forceClose: vi.fn().mockResolvedValue(storedShift({ endedReason: 'supervisor' })),
    listOpen: vi.fn().mockResolvedValue([storedShift()]),
    list: vi.fn().mockResolvedValue({ items: [storedShift()], nextCursor: 'c2' }),
    ...overrides,
  };
}

/** The host's serializer — the package must never invent wire fields. */
const serialize = (shift: Shift): unknown => ({ id: shift.id, kind: shift.kind });

function routeOf(routes: readonly ShiftRoute[], key: string): ShiftRoute {
  const found = routes.find((route) => `${route.method} ${route.path}` === key);
  if (!found) throw new Error(`no route ${key}`);
  return found;
}

const actor = { clientId: 't1', userId: 'u1' };

describe('createApiShift', () => {
  it('refuses construction without the wire shape or the port — host decisions have no defaults', () => {
    expect(() => createApiShift({ shifts: fakePort() } as never)).toThrow(ShiftConfigError);
    expect(() => createApiShift({ serialize } as never)).toThrow(ShiftConfigError);
  });

  it('lists history through the port, serialized by the host, cursor forwarded', async () => {
    const port = fakePort();
    const { routes } = createApiShift({ shifts: port, serialize });
    const answer = await routeOf(routes, 'GET /shifts').handle({
      actor,
      params: {},
      query: { kind: 'kitchen', userId: 'u2', cursor: 'c1', limit: '10' },
    });
    expect(port.list).toHaveBeenCalledWith({
      clientId: 't1',
      kind: 'kitchen',
      userId: 'u2',
      cursor: 'c1',
      limit: 10,
    });
    expect(answer).toEqual({
      status: 200,
      body: { data: { items: [{ id: 's1', kind: 'kitchen' }], nextCursor: 'c2' } },
    });
  });

  it('answers the on-duty roster without a cursor, narrowing userId in memory', async () => {
    const port = fakePort({
      listOpen: vi
        .fn()
        .mockResolvedValue([storedShift(), storedShift({ id: 's2', userId: 'u2' })]),
    });
    const { routes } = createApiShift({ shifts: port, serialize });
    const answer = await routeOf(routes, 'GET /shifts').handle({
      actor,
      params: {},
      query: { open: 'true', userId: 'u2' },
    });
    expect(port.listOpen).toHaveBeenCalledWith({ clientId: 't1' });
    expect(port.list).not.toHaveBeenCalled();
    expect(answer.body).toEqual({
      data: { items: [{ id: 's2', kind: 'kitchen' }], nextCursor: null },
    });
  });

  it('opens for the AMBIENT actor — the body cannot name its own subject', async () => {
    const port = fakePort();
    const { routes } = createApiShift({ shifts: port, serialize });
    await routeOf(routes, 'POST /shifts').handle({
      actor,
      params: {},
      query: {},
      body: { kind: 'kitchen', userId: 'somebody-else' },
    });
    expect(port.open).toHaveBeenCalledWith({ clientId: 't1', userId: 'u1', kind: 'kitchen' });
  });

  it('binds the resource through the host vocabulary, and a binder refusal flows out untouched', async () => {
    const port = fakePort();
    const fromBody = vi.fn().mockResolvedValue({
      resource: { type: 'kitchen_stations', id: 'st1' },
    });
    const { routes } = createApiShift({ shifts: port, serialize, resources: { fromBody } });
    await routeOf(routes, 'POST /shifts').handle({
      actor,
      params: {},
      query: {},
      body: { kind: 'kitchen', stationId: 'st1' },
    });
    expect(fromBody).toHaveBeenCalledWith({ kind: 'kitchen', stationId: 'st1' }, actor);
    expect(port.open).toHaveBeenCalledWith({
      clientId: 't1',
      userId: 'u1',
      kind: 'kitchen',
      resource: { type: 'kitchen_stations', id: 'st1' },
    });
    // The host refuses in its own error language; the package must not
    // absorb what it cannot word.
    const hostRefusal = new Error('um turno se vincula a um recurso só');
    fromBody.mockRejectedValueOnce(hostRefusal);
    await expect(
      routeOf(routes, 'POST /shifts').handle({
        actor,
        params: {},
        query: {},
        body: { kind: 'kitchen' },
      }),
    ).rejects.toBe(hostRefusal);
  });

  it('closes own or force-closes on the explicit mode, never inferring from ownership', async () => {
    const port = fakePort();
    const { routes } = createApiShift({ shifts: port, serialize });
    const close = routeOf(routes, 'PATCH /shifts/:shiftId');
    await close.handle({ actor, params: { shiftId: 's1' }, query: {}, body: { mode: 'own' } });
    expect(port.closeOwn).toHaveBeenCalledWith({ clientId: 't1', shiftId: 's1', userId: 'u1' });
    await close.handle({ actor, params: { shiftId: 's1' }, query: {}, body: { mode: 'force' } });
    expect(port.forceClose).toHaveBeenCalledWith({ clientId: 't1', shiftId: 's1', byUserId: 'u1' });
  });

  it('answers a ShiftError with its code and the status the code earns', async () => {
    const port = fakePort({
      closeOwn: vi
        .fn()
        .mockRejectedValue(new ShiftError('SHIFT_NOT_OWNED', 'not this worker\'s shift')),
    });
    const { routes } = createApiShift({ shifts: port, serialize });
    const answer = await routeOf(routes, 'PATCH /shifts/:shiftId').handle({
      actor,
      params: { shiftId: 's9' },
      query: {},
      body: { mode: 'own' },
    });
    expect(answer).toEqual({
      status: 403,
      body: { error: 'not this worker\'s shift', code: 'SHIFT_NOT_OWNED' },
    });
    expect(SHIFT_ERROR_STATUS.SHIFT_ALREADY_ENDED).toBe(409);
    expect(SHIFT_ERROR_STATUS.SHIFT_NOT_FOUND).toBe(404);
  });

  it('rethrows what is not a shift outcome — the host maps its own errors', async () => {
    const boom = new TypeError('port exploded');
    const port = fakePort({ list: vi.fn().mockRejectedValue(boom) });
    const { routes } = createApiShift({ shifts: port, serialize });
    await expect(
      routeOf(routes, 'GET /shifts').handle({ actor, params: {}, query: {} }),
    ).rejects.toBe(boom);
  });
});
