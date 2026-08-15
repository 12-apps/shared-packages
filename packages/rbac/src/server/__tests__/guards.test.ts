import { describe, expect, it } from 'vitest';

import { RbacApiError } from '../context';


import { assignRole, enrolMember, seedRole } from './fake-db';
import { createTestHost, memberActor, superActor } from './server-fixtures';

/**
 * The guard helpers over the seam (12-13) — the package port of the origin host's
 * `tests/integration/rbac.integration.test.ts` (the FUT-146 foundation) and
 * `custom-role.integration.test.ts` (custom roles grant at runtime). The
 * same assertions run in `harness/backend` against the PUBLISHED tarball over
 * real SQL; here they pin the engine wiring itself.
 */

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

async function seededHost() {
  const host = createTestHost();
  await host.api.seedTenantRoles(TENANT_A);
  await host.api.seedTenantRoles(TENANT_B);
  return host;
}

describe('rbac foundation (FUT-146 port)', () => {
  it('(a) a membership DIRECTOR passes config:write in their tenant', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'owner-1', 'DIRECTOR');
    await expect(
      host.api.guards.requirePermission(
        { userId: 'owner-1', isSuper: false },
        'config:write',
        { scope: TENANT_A },
      ),
    ).resolves.toBeUndefined();
  });

  it('(b) a CLERK is denied config:write', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'waiter-1', 'CLERK');
    await expect(
      host.api.guards.requirePermission(
        { userId: 'waiter-1', isSuper: false },
        'config:write',
        { scope: TENANT_A },
      ),
    ).rejects.toBeInstanceOf(RbacApiError);
  });

  it('(c) a platform admin passes everywhere with no user row', async () => {
    const host = await seededHost();
    await expect(
      host.api.guards.requirePermission({ userId: null, isSuper: true }, 'config:write', {
        scope: TENANT_A,
      }),
    ).resolves.toBeUndefined();
    expect(
      (
        await host.api.guards.visibleResources(
          { userId: null, isSuper: true },
          'loans:read:all',
          'order',
        )
      ).kind,
    ).toBe('all');
  });

  it('(d) getActorPermissions returns the expected set for a BRANCH_LEAD', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'manager-1', 'BRANCH_LEAD');
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'manager-1', isSuper: false },
      TENANT_A,
    );
    expect(perms.has('titles:write')).toBe(true);
    expect(perms.has('loans:read:all')).toBe(true);
    expect(perms.has('team:read')).toBe(true);
    // BRANCH_LEAD must NOT hold owner/admin-only powers.
    expect(perms.has('config:write')).toBe(false);
    expect(perms.has('roles:manage')).toBe(false);
    expect(perms.has('budget:manage')).toBe(false);
  });

  it('(e) the assignment relation is tenant-scoped — no cross-tenant leak', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'waiter-1', 'CLERK');
    assignRole(host.state, 'waiter-1', 'CLERK', TENANT_B);
    host.state.resourceAssignments.push({
      id: 'ra-1',
      userId: 'waiter-1',
      clientId: TENANT_A,
      resourceType: 'loans',
      resourceId: 'order-a1',
      // Fixed and in the past relative to any run — the resolver's temporal
      // filter compares against the wall clock, so "long ago, never revoked"
      // is the deterministic shape of an active assignment.
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validTo: null,
    });
    const inA = await host.api.guards.visibleResources(
      { userId: 'waiter-1', isSuper: false },
      'loans:read:assigned',
      'loans',
      { scope: TENANT_A },
    );
    expect(inA).toEqual({ kind: 'ids', ids: ['order-a1'] });
    const inB = await host.api.guards.visibleResources(
      { userId: 'waiter-1', isSuper: false },
      'loans:read:assigned',
      'loans',
      { scope: TENANT_B },
    );
    expect(inB).toEqual({ kind: 'ids', ids: [] });
  });

  it('a soft-disabled membership resolves to no permissions', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'off-1', 'BRANCH_LEAD', { active: false });
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'off-1', isSuper: false },
      TENANT_A,
    );
    expect(perms.size).toBe(0);
  });

  it('a permission ceiling only ever narrows', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'owner-1', 'DIRECTOR');
    const ceiling = new Set(['titles:read:all']);
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'owner-1', isSuper: false, permissionCeiling: ceiling },
      TENANT_A,
    );
    expect([...perms]).toEqual(['titles:read:all']);
    await expect(
      host.api.guards.requirePermission(
        { userId: 'owner-1', isSuper: false, permissionCeiling: ceiling },
        'config:write',
        { scope: TENANT_A },
      ),
    ).rejects.toBeInstanceOf(RbacApiError);
  });
});

describe('tenant custom-role runtime enforcement (FUT-146 port)', () => {
  const CUSTOM_PERMISSIONS = ['titles:read:all', 'copies:read'] as const;

  it('(a) a custom role grants EXACTLY its permission set — and nothing more', async () => {
    const host = await seededHost();
    seedRole(host.state, {
      clientId: TENANT_A,
      name: 'STOCK_VIEWER',
      permissions: CUSTOM_PERMISSIONS,
    });
    assignRole(host.state, 'custom-1', 'STOCK_VIEWER', TENANT_A);
    const actor = { userId: 'custom-1', isSuper: false };
    await expect(
      host.api.guards.requirePermission(actor, 'titles:read:all', { scope: TENANT_A }),
    ).resolves.toBeUndefined();
    await expect(
      host.api.guards.requirePermission(actor, 'copies:move', { scope: TENANT_A }),
    ).rejects.toBeInstanceOf(RbacApiError);
    const perms = await host.api.guards.getActorPermissions(actor, TENANT_A);
    expect([...perms].sort()).toEqual([...CUSTOM_PERMISSIONS].sort());
  });

  it('(b) the same assignment with no backing roles row grants nothing', async () => {
    const host = await seededHost();
    assignRole(host.state, 'custom-1', 'STOCK_VIEWER', TENANT_A);
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'custom-1', isSuper: false },
      TENANT_A,
    );
    expect(perms.size).toBe(0);
  });

  it("(c) a wildcard ('*') custom role grants everything in its tenant", async () => {
    const host = await seededHost();
    seedRole(host.state, { clientId: TENANT_A, name: 'TENANT_ADMIN_PLUS', permissions: '*' });
    assignRole(host.state, 'custom-1', 'TENANT_ADMIN_PLUS', TENANT_A);
    await expect(
      host.api.guards.requirePermission(
        { userId: 'custom-1', isSuper: false },
        'config:write',
        { scope: TENANT_A },
      ),
    ).resolves.toBeUndefined();
  });

  it('(d) a custom role does not grant at another tenant', async () => {
    const host = await seededHost();
    seedRole(host.state, {
      clientId: TENANT_A,
      name: 'STOCK_VIEWER',
      permissions: CUSTOM_PERMISSIONS,
    });
    assignRole(host.state, 'custom-1', 'STOCK_VIEWER', TENANT_A);
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'custom-1', isSuper: false },
      TENANT_B,
    );
    expect(perms.size).toBe(0);
  });

  it('(e) a same-named role only applies at its own tenant', async () => {
    const host = await seededHost();
    seedRole(host.state, { clientId: TENANT_A, name: 'OPS', permissions: ['titles:read:all'] });
    seedRole(host.state, { clientId: TENANT_B, name: 'OPS', permissions: ['copies:read'] });
    assignRole(host.state, 'custom-1', 'OPS', TENANT_A);
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'custom-1', isSuper: false },
      TENANT_A,
    );
    expect([...perms]).toEqual(['titles:read:all']);
    expect(perms.has('copies:read')).toBe(false);
  });

  it('an ARCHIVED custom role stops granting at runtime', async () => {
    const host = await seededHost();
    seedRole(host.state, {
      clientId: TENANT_A,
      name: 'STOCK_VIEWER',
      permissions: CUSTOM_PERMISSIONS,
      // WHEN it was archived is irrelevant — `archived_at IS NULL` is the
      // whole filter — so a fixed instant keeps the fixture deterministic.
      archivedAt: new Date('2026-01-01T00:00:00Z'),
    });
    assignRole(host.state, 'custom-1', 'STOCK_VIEWER', TENANT_A);
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'custom-1', isSuper: false },
      TENANT_A,
    );
    expect(perms.size).toBe(0);
  });
});

describe('the super/ceiling belt (a ceiling is authoritative)', () => {
  it('a platform admin carrying a ceiling is narrowed, never unioned', async () => {
    // Every guard short-circuits on isSuper before any check runs, so a host
    // that forgot to force it false while impersonating would silently get
    // the union. The belt treats the ceiling as authoritative instead.
    const host = await seededHost();
    const actor = {
      userId: null,
      isSuper: true,
      permissionCeiling: new Set(['titles:read:all']),
    };
    await expect(
      host.api.guards.requirePermission(actor, 'budget:manage', { scope: TENANT_A }),
    ).rejects.toBeInstanceOf(RbacApiError);
    const perms = await host.api.guards.getActorPermissions(actor, TENANT_A);
    expect(perms.size).toBeLessThanOrEqual(1);
    expect(
      (await host.api.guards.visibleResources(actor, 'loans:read:all', 'loans')).kind,
    ).toBe('none');
  });
});

describe('archived roles on the MEMBERSHIP-JOIN path', () => {
  it('an archived role linked through a membership stops granting', async () => {
    // The roleAssignment path is covered above; this pins the join path the
    // resolver reads for ordinary staff (engine.ts fromMemberships).
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'waiter-1', 'CLERK');
    const waiterRow = host.state.roles.find(
      (row) => row.clientId === TENANT_A && row.name === 'CLERK',
    );
    expect(waiterRow).toBeDefined();
    if (waiterRow) waiterRow.archivedAt = new Date('2026-01-01T00:00:00Z');
    const perms = await host.api.guards.getActorPermissions(
      { userId: 'waiter-1', isSuper: false },
      TENANT_A,
    );
    expect(perms.size).toBe(0);
  });
});

describe('actor helpers', () => {
  it('memberActor/superActor build the route actor shapes', async () => {
    const host = await seededHost();
    enrolMember(host.state, TENANT_A, 'owner-1', 'DIRECTOR');
    expect(memberActor(TENANT_A, 'owner-1').isSuper).toBe(false);
    expect(superActor(TENANT_A).userId).toBeNull();
  });
});
