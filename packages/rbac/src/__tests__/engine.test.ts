import { describe, it, expect } from 'vitest';
import { createRbac } from '../core/engine';
import { PermissionDeniedError } from '../core/errors';
import type { AssignmentResolver, RoleAssignment } from '../core/types';
import { DEMO_CATALOG, type DemoPermission } from './demo-catalog';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makeEngine(resolver: AssignmentResolver) {
  return createRbac<DemoPermission>({
    permissions: DEMO_CATALOG.permissions,
    roles: DEMO_CATALOG.roleTemplates,
    resolver,
  });
}

const assignments: Record<string, RoleAssignment[]> = {
  owner: [{ role: 'DIRECTOR', scope: TENANT_A }],
  waiter: [{ role: 'CLERK', scope: TENANT_A }],
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
      rbac.can('waiter', 'desk:open', null, { scope: TENANT_A }),
    ).resolves.toBe(false);
  });

  it('denies an actor with no assignments', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    await expect(
      rbac.can('none', 'titles:read:all', null, { scope: TENANT_A }),
    ).resolves.toBe(false);
  });
});

describe('createRbac — async resolver', () => {
  it('awaits an async resolver', async () => {
    const rbac = makeEngine(async (id) => Promise.resolve(assignments[id] ?? []));
    await expect(
      rbac.can('owner', 'titles:read:all', null, { scope: TENANT_A }),
    ).resolves.toBe(true);
  });
});

describe('createRbac — getPermissions / canWithAssignments', () => {
  it('getPermissions() returns the scoped union', async () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    const perms = await rbac.getPermissions('waiter', TENANT_A);
    expect(perms.has('loans:create')).toBe(true);
    expect(perms.has('config:write')).toBe(false);
  });

  it('canWithAssignments() is a sync escape hatch', () => {
    const rbac = makeEngine((id) => assignments[id] ?? []);
    expect(
      rbac.canWithAssignments(assignments.owner!, 'loans:waive', TENANT_A),
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
  // CLERK holds loans:read:assigned (instance). Ownership + assignment gate.
  function mk() {
    return createRbac<DemoPermission>({
      permissions: DEMO_CATALOG.permissions,
      roles: DEMO_CATALOG.roleTemplates,
      resolver: (id) => assignments[id] ?? [],
      ownership: (_subject, type) =>
        type === 'loans' ? { kind: 'field', field: 'waiter_id' } : null,
      assignmentResolver: (_subject, type) =>
        type === 'loans' ? ['order-1', 'order-2'] : [],
    });
  }

  it('denies an instance action when RBAC itself denies (waiter lacks the class perm)', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'loans:void', 'order-1', { scope: TENANT_A }),
    ).resolves.toBe(false);
  });

  it('grants an assigned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'loans:read:assigned', 'order-1', {
        scope: TENANT_A,
      }),
    ).resolves.toBe(true);
  });

  it('denies an unassigned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'loans:read:assigned', 'order-999', {
        scope: TENANT_A,
      }),
    ).resolves.toBe(false);
  });

  it('visibleResources returns a predicate union for instance perms', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources('waiter', 'loans:read:assigned', 'loans', {
      scope: TENANT_A,
    });
    expect(v.kind).toBe('predicate');
  });

  it('visibleResources returns all for a class perm the actor holds', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources('owner', 'titles:read:all', 'titles', {
      scope: TENANT_A,
    });
    expect(v).toEqual({ kind: 'all' });
  });

  it('visibleResources returns none when denied', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources('waiter', 'reports:circulation:read', 'reports', {
      scope: TENANT_A,
    });
    expect(v).toEqual({ kind: 'none' });
  });
});
