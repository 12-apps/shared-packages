import { describe, it, expect } from 'vitest';
import { createRbac } from '../core/engine';
import { PermissionDeniedError } from '../core/errors';
import type { AssignmentResolver, RoleAssignment } from '../core/types';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_PERMISSIONS,
  type FuturePayPermission,
} from '../templates';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makeEngine(resolver: AssignmentResolver) {
  return createRbac<FuturePayPermission>({
    permissions: FUTURE_PAY_PERMISSIONS,
    roles: DEFAULT_ROLE_TEMPLATES,
    resolver,
  });
}

const assignments: Record<string, RoleAssignment[]> = {
  owner: [{ role: 'OWNER', scope: TENANT_A }],
  waiter: [{ role: 'WAITER', scope: TENANT_A }],
  none: [],
};

describe('createRbac — converged can() (class permissions)', () => {
  it('grants a class permission for an owner in scope', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.can('owner', 'config:write', null, { scope: TENANT_A }),
    ).resolves.toBe(true);
  });

  it('denies out of scope', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.can('owner', 'config:write', null, { scope: TENANT_B }),
    ).resolves.toBe(false);
  });

  it('denies for a waiter lacking the permission', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.can('waiter', 'till:open', null, { scope: TENANT_A }),
    ).resolves.toBe(false);
  });

  it('denies an actor with no assignments', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.can('none', 'products:read:all', null, { scope: TENANT_A }),
    ).resolves.toBe(false);
  });
});

describe('createRbac — async resolver', () => {
  it('awaits an async resolver', async () => {
    const rbac = makeEngine(async (id) => Promise.resolve(assignments[id] ?? []));
    await expect(
      rbac.can('owner', 'products:read:all', null, { scope: TENANT_A }),
    ).resolves.toBe(true);
  });
});

describe('createRbac — getPermissions / canWithAssignments', () => {
  it('getPermissions() returns the scoped union', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    const perms = await rbac.getPermissions('waiter', TENANT_A);
    expect(perms.has('orders:create')).toBe(true);
    expect(perms.has('config:write')).toBe(false);
  });

  it('canWithAssignments() is a sync escape hatch', () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    expect(
      rbac.canWithAssignments(assignments.owner!, 'orders:refund', TENANT_A),
    ).toBe(true);
  });
});

describe('createRbac — requirePermission', () => {
  it('resolves silently when granted', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.requirePermission('owner', 'config:write', null, { scope: TENANT_A }),
    ).resolves.toBeUndefined();
  });

  it('throws PermissionDeniedError with correct fields when denied', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.requirePermission('waiter', 'config:write', null, {
        scope: TENANT_A,
      }),
    ).rejects.toMatchObject({
      name: 'PermissionDeniedError',
      actorId: 'waiter',
      permission: 'config:write',
      scope: TENANT_A,
    });
    await expect(
      rbac.requirePermission('waiter', 'config:write', null, {
        scope: TENANT_A,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('createRbac — instance permissions & the entity gate', () => {
  // WAITER holds orders:read:assigned (instance). Ownership + assignment gate.
  function mk() {
    return createRbac<FuturePayPermission>({
      permissions: FUTURE_PAY_PERMISSIONS,
      roles: DEFAULT_ROLE_TEMPLATES,
      resolver: (id) => assignments[id] ?? [],
      ownership: (_subject, type) =>
        type === 'orders' ? { kind: 'field', field: 'waiter_id' } : null,
      assignmentResolver: (_subject, type) =>
        type === 'orders' ? ['order-1', 'order-2'] : [],
    });
  }

  it('denies an instance action when RBAC itself denies (waiter lacks the class perm)', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'orders:void', 'order-1', { scope: TENANT_A }),
    ).resolves.toBe(false);
  });

  it('grants an assigned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'orders:read:assigned', 'order-1', {
        scope: TENANT_A,
      }),
    ).resolves.toBe(true);
  });

  it('denies an unassigned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'orders:read:assigned', 'order-999', {
        scope: TENANT_A,
      }),
    ).resolves.toBe(false);
  });

  it('visibleResources returns a predicate union for instance perms', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources('waiter', 'orders:read:assigned', 'orders', {
      scope: TENANT_A,
    });
    expect(v.kind).toBe('predicate');
  });

  it('visibleResources returns all for a class perm the actor holds', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources('owner', 'products:read:all', 'products', {
      scope: TENANT_A,
    });
    expect(v).toEqual({ kind: 'all' });
  });

  it('visibleResources returns none when denied', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources('waiter', 'reports:sales:read', 'reports', {
      scope: TENANT_A,
    });
    expect(v).toEqual({ kind: 'none' });
  });
});
