import { describe, expect, it } from 'vitest';

import type { RbacActor, RbacRequest, RbacResponse, RbacRoute } from '../context';
import type { RbacDbClient } from '../db';
import { lockTenantOwnership } from '../owner-guard';
import { PT_BR_RBAC_MESSAGES } from '../pt-BR';
import {
  enrolMember,
  seedRole,
  type FakeRbacCall,
  type FakeRbacDbOptions,
  type FakeRbacState,
} from './fake-db';
import { createTestHost, memberActor, superActor, type TestHost } from './server-fixtures';

/**
 * The ownership rules (FUT-2435), on the two writes that can take an owner
 * role away: `DELETE /team/:userId/roles/:role` and `DELETE /team/:userId`.
 * There is no third: `PATCH /team/:userId`, the swap of a member's highest
 * role, went in FUT-2440, and with it the demotion rules it ran.
 *
 * "Owner" in every assertion here is who COUNTS as one: an active member whose
 * role column names an owner role and who holds a link to a live owner-role
 * row. The fake writes the column verbatim unless a test hands it the
 * deriving hook, so a revoke leaves the column saying DIRECTOR; that is the
 * state the rules must not be fooled by.
 */

const TENANT = 'tenant-a';
const OWNER_ROLES = new Set(['DIRECTOR', 'NETWORK_OPS']);

const REVOKE = ['DELETE', '/team/:userId/roles/:role'] as const;
const REMOVE = ['DELETE', '/team/:userId'] as const;

function route(h: TestHost, method: string, path: string): RbacRoute {
  const found = h.api.routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found;
}

function call(
  h: TestHost,
  [method, path]: readonly [string, string],
  request: Partial<RbacRequest> & { actor: RbacActor },
): Promise<RbacResponse> {
  return route(h, method, path).handle({ params: {}, query: {}, ...request });
}

const refusal = (response: RbacResponse): string => (response.body as { error: string }).error;
const data = (response: RbacResponse): Record<string, unknown> =>
  (response.body as { data: Record<string, unknown> }).data;

/** A tenant with the demo catalog seeded and the named members enrolled. */
async function host(
  members: Record<string, string>,
  fake: FakeRbacDbOptions = {},
): Promise<TestHost> {
  const h = createTestHost({}, fake);
  await h.api.seedTenantRoles(TENANT);
  for (const [userId, role] of Object.entries(members)) enrolMember(h.state, TENANT, userId, role);
  return h;
}

const TWO_OWNERS = { 'owner-1': 'DIRECTOR', 'owner-2': 'DIRECTOR', 'admin-1': 'HEAD_LIBRARIAN' };
const ONE_OWNER = { 'owner-1': 'DIRECTOR', 'admin-1': 'HEAD_LIBRARIAN' };

function membershipOf(state: FakeRbacState, userId: string) {
  const row = state.memberships.find((m) => m.clientId === TENANT && m.userId === userId);
  if (!row) throw new Error(`No membership ${userId}`);
  return row;
}

function roleIdOf(state: FakeRbacState, name: string): string {
  const row = state.roles.find((r) => r.clientId === TENANT && r.name === name);
  if (!row) throw new Error(`No role ${name}`);
  return row.id;
}

function holdsLink(state: FakeRbacState, userId: string, roleName: string): boolean {
  const membershipId = membershipOf(state, userId).id;
  const roleId = roleIdOf(state, roleName);
  return state.membershipRoles.some((l) => l.membershipId === membershipId && l.roleId === roleId);
}

function addLink(state: FakeRbacState, userId: string, roleName: string): void {
  state.membershipRoles.push({
    id: `link-${userId}-${roleName}`,
    membershipId: membershipOf(state, userId).id,
    roleId: roleIdOf(state, roleName),
  });
}

function dropLink(state: FakeRbacState, userId: string, roleName: string): void {
  const membershipId = membershipOf(state, userId).id;
  const roleId = roleIdOf(state, roleName);
  state.membershipRoles = state.membershipRoles.filter(
    (l) => !(l.membershipId === membershipId && l.roleId === roleId),
  );
}

function disable(state: FakeRbacState, userId: string): void {
  membershipOf(state, userId).active = false;
}

/**
 * A host's ownership transfer, written straight into the rows: the heir takes
 * the column and the link, the former owner keeps a lower role.
 */
function transferOwnership(state: FakeRbacState, from: string, to: string): void {
  dropLink(state, from, 'DIRECTOR');
  addLink(state, from, 'HEAD_LIBRARIAN');
  membershipOf(state, from).role = 'HEAD_LIBRARIAN';
  addLink(state, to, 'DIRECTOR');
  membershipOf(state, to).role = 'DIRECTOR';
}

/** Who counts as an owner, computed from the rows rather than asked of the code. */
function countedOwners(state: FakeRbacState): string[] {
  const liveOwnerRows = new Set(
    state.roles
      .filter((r) => r.clientId === TENANT && OWNER_ROLES.has(r.name) && r.archivedAt === null)
      .map((r) => r.id),
  );
  const linked = new Set(
    state.membershipRoles.filter((l) => liveOwnerRows.has(l.roleId)).map((l) => l.membershipId),
  );
  return state.memberships
    .filter((m) => m.clientId === TENANT && m.active && OWNER_ROLES.has(m.role) && linked.has(m.id))
    .map((m) => m.userId)
    .sort();
}

async function permissionsOf(h: TestHost, userId: string): Promise<Set<string>> {
  return h.api.guards.getActorPermissions({ userId, isSuper: false }, TENANT);
}

describe('revoking an owner role', () => {
  it('r1: refuses a caller who is not an owner, and writes nothing', async () => {
    const h = await host(TWO_OWNERS);
    const response = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'admin-1'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(response.status).toBe(403);
    expect(refusal(response)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);
    expect(holdsLink(h.state, 'owner-1', 'DIRECTOR')).toBe(true);
    expect(h.audits.some((entry) => entry.action === 'team.role_revoke')).toBe(false);
  });

  it('r2: never takes it from the last owner, themself included', async () => {
    const h = await host(ONE_OWNER);
    const response = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(response.status).toBe(409);
    expect(refusal(response)).toBe(PT_BR_RBAC_MESSAGES.lastOwner);
    expect((await permissionsOf(h, 'owner-1')).has('roles:manage')).toBe(true);
  });

  it("r3: lets an owner take a co-owner's, and the permissions go with it", async () => {
    const h = await host(TWO_OWNERS);
    const response = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-2', role: 'DIRECTOR' },
    });
    expect(response.status).toBe(200);
    expect(data(response)).toEqual({ status: 'revoked' });
    expect((await permissionsOf(h, 'owner-2')).has('roles:manage')).toBe(false);
    expect(countedOwners(h.state)).toEqual(['owner-1']);
    expect(h.audits.filter((entry) => entry.action === 'team.role_revoke')).toHaveLength(1);
  });

  it('r4: a disabled owner is never the one who remains', async () => {
    const h = await host(TWO_OWNERS);
    disable(h.state, 'owner-2');
    const self = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(self.status).toBe(409);
    const platform = await call(h, REVOKE, {
      actor: superActor(TENANT),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(platform.status).toBe(409);
    expect(holdsLink(h.state, 'owner-1', 'DIRECTOR')).toBe(true);
  });

  it('r5: the platform operator may; the same flag under a ceiling may not', async () => {
    const h = await host(TWO_OWNERS);
    const platform = await call(h, REVOKE, {
      actor: superActor(TENANT),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(platform.status).toBe(200);

    const previewed = await host(TWO_OWNERS);
    // A member previewing through a ceiling that still holds `roles:manage`:
    // the permission guard lets them in, and the ownership rule judges their
    // own membership, which is not an owner's.
    const response = await call(previewed, REVOKE, {
      actor: {
        ...memberActor(TENANT, 'admin-1'),
        isSuper: true,
        permissionCeiling: new Set(['roles:manage']),
      },
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(response.status).toBe(403);
    expect(refusal(response)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);
  });

  it('r6: a non-owner role is revoked exactly as before, with no lock', async () => {
    const h = await host(TWO_OWNERS);
    h.calls.splice(0);
    const response = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'admin-1'),
      params: { userId: 'owner-1', role: 'HEAD_LIBRARIAN' },
    });
    expect(response.status).toBe(200);
    expect(h.calls.some((c) => c.op === 'role.updateMany')).toBe(false);
    expect(h.calls.filter((c) => c.op === 'membershipRole.deleteMany')).toEqual([
      expect.objectContaining({ txId: null, op: 'membershipRole.deleteMany' }),
    ]);
  });

  it('r7: revoking an owner role from someone who does not hold it is a no-op', async () => {
    const h = await host(TWO_OWNERS);
    const response = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'admin-1'),
      params: { userId: 'admin-1', role: 'DIRECTOR' },
    });
    expect(response.status).toBe(200);
    expect(h.audits.some((entry) => entry.action === 'team.role_revoke')).toBe(false);
  });

  it('r8: an owner whose link was revoked is no longer an owner, column or not', async () => {
    // The verbatim host: the revoke deletes the link and the column still
    // says DIRECTOR. owner-2 keeps `roles:manage` through HEAD_LIBRARIAN, so
    // only the ownership rule stands between them and owner-1's link.
    const h = await host(TWO_OWNERS);
    addLink(h.state, 'owner-2', 'HEAD_LIBRARIAN');
    const first = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-2', role: 'DIRECTOR' },
    });
    expect(first.status).toBe(200);
    expect(membershipOf(h.state, 'owner-2').role).toBe('DIRECTOR');

    const back = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-2'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(back.status).toBe(403);
    expect(refusal(back)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);

    const self = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(self.status).toBe(409);
    expect(countedOwners(h.state)).toEqual(['owner-1']);
  });

  it('r9: a column-only owner neither remains nor acts as one, on any route', async () => {
    const h = await host(TWO_OWNERS);
    dropLink(h.state, 'owner-2', 'DIRECTOR');
    addLink(h.state, 'owner-2', 'HEAD_LIBRARIAN');
    const selfRevoke = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(selfRevoke.status).toBe(409);
    const removal = await call(h, REMOVE, {
      actor: memberActor(TENANT, 'owner-2'),
      params: { userId: 'owner-1' },
    });
    expect(removal.status).toBe(403);
    expect(refusal(removal)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);
    const revoke = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-2'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(revoke.status).toBe(403);
    expect(refusal(revoke)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);
    expect(countedOwners(h.state)).toEqual(['owner-1']);
  });

  it('r10: a tenant with no owner-role row keeps the column-only rules, unlocked', async () => {
    // Nothing seeded: no DIRECTOR row to link to, so the column decides.
    const h = createTestHost();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    await expect(
      h.api.team.removeTenantMemberGuarded(TENANT, 'owner-1', {
        role: 'DIRECTOR',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    enrolMember(h.state, TENANT, 'owner-2', 'DIRECTOR');
    await expect(
      h.api.team.removeTenantMemberGuarded(TENANT, 'owner-1', {
        role: 'HEAD_LIBRARIAN',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await h.api.team.removeTenantMemberGuarded(TENANT, 'owner-1', {
      role: 'DIRECTOR',
      isPlatformActor: false,
      userId: 'owner-2',
    });
    await expect(
      h.api.team.removeTenantMemberGuarded(TENANT, 'owner-2', {
        role: 'DIRECTOR',
        isPlatformActor: false,
        userId: 'owner-2',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.calls.some((c) => c.op === 'role.updateMany')).toBe(false);
  });
});

describe('removing an owner (DELETE /team/:userId)', () => {
  it('d1: counts only ACTIVE owners', async () => {
    const h = await host(TWO_OWNERS);
    disable(h.state, 'owner-2');
    const platform = await call(h, REMOVE, {
      actor: superActor(TENANT),
      params: { userId: 'owner-1' },
    });
    expect(platform.status).toBe(409);
    const disabledOne = await call(h, REMOVE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-2' },
    });
    expect(disabledOne.status).toBe(200);
    expect(h.state.memberships.some((m) => m.userId === 'owner-2')).toBe(false);
  });

  it('d2: refuses a caller who is not an owner', async () => {
    const h = await host(TWO_OWNERS);
    const response = await call(h, REMOVE, {
      actor: memberActor(TENANT, 'admin-1'),
      params: { userId: 'owner-1' },
    });
    expect(response.status).toBe(403);
    expect(refusal(response)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);
  });

  it('d3: a member holding an owner link the column does not name is guarded too', async () => {
    // A transfer's residue: the column moved on, the owner link stayed.
    const h = await host(TWO_OWNERS);
    addLink(h.state, 'admin-1', 'DIRECTOR');
    enrolMember(h.state, TENANT, 'admin-2', 'HEAD_LIBRARIAN');
    const refused = await call(h, REMOVE, {
      actor: memberActor(TENANT, 'admin-2'),
      params: { userId: 'admin-1' },
    });
    expect(refused.status).toBe(403);
    const removed = await call(h, REMOVE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'admin-1' },
    });
    expect(removed.status).toBe(200);
  });

  it('d4: an isSuper caller carrying a ceiling is judged on its own membership', async () => {
    const h = await host(TWO_OWNERS);
    const response = await call(h, REMOVE, {
      actor: {
        ...memberActor(TENANT, 'admin-1'),
        isSuper: true,
        permissionCeiling: new Set(['team:manage']),
      },
      params: { userId: 'owner-1' },
    });
    expect(response.status).toBe(403);
    expect(refusal(response)).toBe(PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner);
  });

  it('d5: the staff tier reads the same flag the same way', async () => {
    const h = await host(TWO_OWNERS);
    const response = await call(h, ['GET', '/permissions'], {
      actor: { ...superActor(TENANT), permissionCeiling: new Set(['team:read']) },
    });
    expect(response.status).toBe(403);
  });
});

/**
 * A host whose role column is DERIVED from the links, ranked by the demo
 * catalog's own order — the shape the origin host has had since FUT-2446.
 */
const RANK = ['DIRECTOR', 'HEAD_LIBRARIAN', 'BRANCH_LEAD', 'CLERK', 'CONSERVATOR', 'TREASURER', 'SELECTOR'];

function deriveByRank(state: FakeRbacState, membershipId: string): void {
  const member = state.memberships.find((m) => m.id === membershipId);
  if (!member) return;
  const held = new Set(
    state.membershipRoles
      .filter((l) => l.membershipId === membershipId)
      .flatMap((l) => state.roles.filter((r) => r.id === l.roleId && r.archivedAt === null))
      .map((r) => r.name),
  );
  member.role = RANK.find((name) => held.has(name)) ?? 'PATRON';
}

describe('direct store calls', () => {
  it('s1: a revoke with no caller keeps the invariant only', async () => {
    const h = await host(TWO_OWNERS);
    await h.api.team.revokeCustomRoleFromMember(TENANT, 'owner-1', 'DIRECTOR');
    expect(holdsLink(h.state, 'owner-1', 'DIRECTOR')).toBe(false);
    await expect(
      h.api.team.revokeCustomRoleFromMember(TENANT, 'owner-2', 'DIRECTOR'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('s2: a tier without a user id is judged by its role, as before', async () => {
    const h = await host(TWO_OWNERS);
    await expect(
      h.api.team.removeTenantMemberGuarded(TENANT, 'owner-1', {
        role: 'HEAD_LIBRARIAN',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await h.api.team.removeTenantMemberGuarded(TENANT, 'owner-1', {
      role: 'DIRECTOR',
      isPlatformActor: false,
    });
    expect(countedOwners(h.state)).toEqual(['owner-2']);
  });

  it('s5: a caller who is not the platform operator and names no user is refused', async () => {
    const h = await host(TWO_OWNERS);
    const nobody = { role: null, isPlatformActor: false, userId: null };
    await expect(
      h.api.team.removeTenantMemberGuarded(TENANT, 'owner-1', nobody),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      h.api.team.revokeCustomRoleFromMember(TENANT, 'owner-1', 'DIRECTOR', undefined, nobody),
    ).rejects.toMatchObject({ status: 403 });
    expect(countedOwners(h.state)).toEqual(['owner-1', 'owner-2']);
  });

  it('s7: revoking one owner role from a member who keeps another runs no owner rule', async () => {
    const h = await host(ONE_OWNER);
    seedRole(h.state, { clientId: TENANT, name: 'NETWORK_OPS', permissions: '*', kind: 'SYSTEM', locked: true });
    addLink(h.state, 'owner-1', 'NETWORK_OPS');
    const response = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-1', role: 'DIRECTOR' },
    });
    expect(response.status).toBe(200);
    expect(holdsLink(h.state, 'owner-1', 'DIRECTOR')).toBe(false);
    expect(holdsLink(h.state, 'owner-1', 'NETWORK_OPS')).toBe(true);
    // The last owner role is still guarded: dropping NETWORK_OPS too would
    // leave the tenant with nobody holding one.
    const last = await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-1', role: 'NETWORK_OPS' },
    });
    expect(last.status).toBe(409);
    expect(holdsLink(h.state, 'owner-1', 'NETWORK_OPS')).toBe(true);
  });
});

/** The row ids the lock statements named, in the order they ran. */
function lockedIds(calls: readonly FakeRbacCall[]): string[] {
  return calls
    .filter((c) => c.op === 'role.updateMany')
    .map((c) => (c.args as { where: { id: string } }).where.id);
}

/** The statements one transaction issued, in order. */
function opsOf(calls: readonly FakeRbacCall[]): string[] {
  const txIds = [...new Set(calls.flatMap((c) => (c.txId === null ? [] : [c.txId])))];
  expect(txIds).toHaveLength(1);
  const first = calls.findIndex((c) => c.txId === txIds[0]);
  const last = calls.map((c) => c.txId).lastIndexOf(txIds[0] ?? null);
  // Nothing went through the root client while the transaction was open.
  expect(calls.slice(first, last + 1).every((c) => c.txId === txIds[0])).toBe(true);
  return calls.slice(first, last + 1).map((c) => c.op);
}

/**
 * The lock is the transaction's first statement (the owner rows it locks are
 * read in the same breath), every read the decision depends on follows it,
 * and the write follows them.
 */
function expectLockedBeforeDeciding(ops: readonly string[], write: string): void {
  expect(ops.slice(0, 2)).toEqual(['role.findMany', 'role.updateMany']);
  expect(ops.indexOf('membershipRole.findMany')).toBeGreaterThan(1);
  expect(ops.indexOf('membership.findMany')).toBeGreaterThan(1);
  expect(ops.indexOf(write)).toBeGreaterThan(ops.indexOf('membership.findMany'));
}

describe('the ownership lock', () => {
  it('l1: every owner-taking write locks before it decides, and writes last', async () => {
    const h = await host(TWO_OWNERS);
    const owner1 = memberActor(TENANT, 'owner-1');

    h.calls.splice(0);
    await call(h, REVOKE, { actor: owner1, params: { userId: 'owner-2', role: 'DIRECTOR' } });
    const revoke = opsOf(h.calls);
    expectLockedBeforeDeciding(revoke, 'membershipRole.deleteMany');
    expect(revoke.at(-1)).toBe('membershipRole.deleteMany');

    const third = await host(TWO_OWNERS);
    third.calls.splice(0);
    await call(third, REMOVE, { actor: owner1, params: { userId: 'owner-2' } });
    const removal = opsOf(third.calls);
    expectLockedBeforeDeciding(removal, 'membership.deleteMany');
    // The target itself is read inside the transaction, after the lock.
    expect(removal.indexOf('membership.findUnique')).toBeGreaterThan(1);
    expect(removal.at(-1)).toBe('roleAssignment.deleteMany');

    // A removal locks whoever it removes: the target is only known to own
    // nothing once the lock says no host is promoting them.
    third.calls.splice(0);
    await call(third, REMOVE, { actor: owner1, params: { userId: 'admin-1' } });
    expect(opsOf(third.calls).slice(0, 2)).toEqual(['role.findMany', 'role.updateMany']);
  });

  it('l2: the lock changes nothing on the owner row but its updated-at', async () => {
    const h = await host(TWO_OWNERS);
    const row = h.state.roles.find((r) => r.clientId === TENANT && r.name === 'DIRECTOR');
    const before = { ...row };
    await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-2', role: 'DIRECTOR' },
    });
    const after = h.state.roles.find((r) => r.clientId === TENANT && r.name === 'DIRECTOR');
    expect(after).toMatchObject({
      name: before.name,
      kind: before.kind,
      permissions: before.permissions,
      locked: before.locked,
      archivedAt: before.archivedAt,
    });
    expect(after?.updatedAt?.getTime()).toBeGreaterThan(before.updatedAt?.getTime() ?? Infinity);
  });

  it('l5: a removal waits for a host holding the lock, then sees its promotion', async () => {
    const waiting = latch();
    const h = await host(
      { 'owner-1': 'DIRECTOR', 'admin-1': 'HEAD_LIBRARIAN', heir: 'CONSERVATOR' },
      { onLockWait: () => waiting.open() },
    );
    const committed = latch();
    // The host's transfer to `heir`, under the package's lock (rule 10). Its
    // writes land when it lets go, as a commit makes them visible.
    const transfer = h.db.$transaction(async (tx) => {
      await lockTenantOwnership(tx, TENANT, OWNER_ROLES);
      await committed.opened;
      transferOwnership(h.state, 'owner-1', 'heir');
    });
    const removal = call(h, REMOVE, {
      actor: memberActor(TENANT, 'admin-1'),
      params: { userId: 'heir' },
    }).finally(waiting.open);
    await waiting.opened;
    committed.open();
    await transfer;
    const response = await removal;
    expect(response.status).toBe(403);
    expect(countedOwners(h.state)).toEqual(['heir']);
  });

  it('l6: a revoke waits for a host holding the lock, then sees its promotion', async () => {
    const waiting = latch();
    const h = await host(
      { 'owner-1': 'DIRECTOR', 'admin-1': 'HEAD_LIBRARIAN', heir: 'CONSERVATOR' },
      { onLockWait: () => waiting.open() },
    );
    const committed = latch();
    const transfer = h.db.$transaction(async (tx) => {
      await lockTenantOwnership(tx, TENANT, OWNER_ROLES);
      await committed.opened;
      transferOwnership(h.state, 'owner-1', 'heir');
    });
    // Before the transfer commits, `heir` holds no DIRECTOR link and the revoke
    // would be a no-op (r7); after it, the revoke takes ownership and is judged.
    const revoke = call(h, REVOKE, {
      actor: memberActor(TENANT, 'admin-1'),
      params: { userId: 'heir', role: 'DIRECTOR' },
    }).finally(waiting.open);
    await waiting.opened;
    committed.open();
    await transfer;
    const response = await revoke;
    expect(response.status).toBe(403);
    expect(countedOwners(h.state)).toEqual(['heir']);
  });

  it('l7: with several owner-role rows, the lock takes them in id order', async () => {
    const h = await host(TWO_OWNERS);
    // A second live owner row whose id sorts BEFORE the DIRECTOR row's and
    // whose name sorts after it, so neither the read order nor chance can pass.
    seedRole(h.state, { clientId: TENANT, name: 'NETWORK_OPS', permissions: '*', kind: 'SYSTEM', locked: true });
    h.calls.splice(0);
    await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-2', role: 'DIRECTOR' },
    });
    const locked = lockedIds(h.calls);
    expect(locked).toHaveLength(2);
    expect(locked).toEqual([...locked].sort());
  });

  it('l8: an archived owner-role row is not locked', async () => {
    const h = await host(TWO_OWNERS);
    seedRole(h.state, {
      clientId: TENANT,
      name: 'NETWORK_OPS',
      permissions: '*',
      kind: 'SYSTEM',
      locked: true,
      archivedAt: new Date(Date.UTC(2026, 0, 2)),
    });
    h.calls.splice(0);
    await call(h, REVOKE, {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'owner-2', role: 'DIRECTOR' },
    });
    expect(lockedIds(h.calls)).toEqual([roleIdOf(h.state, 'DIRECTOR')]);
  });

  it('l4: a lock statement that matched nothing is an error, not a silent pass', async () => {
    const tx = {
      role: {
        findMany: async () => [
          { id: 'r1', clientId: TENANT, name: 'DIRECTOR', permissions: '*', description: null, kind: 'SYSTEM', locked: true },
        ],
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as RbacDbClient;
    await expect(lockTenantOwnership(tx, TENANT, ['DIRECTOR'])).rejects.toThrow(/matched 0 rows/);
  });
});

/** An opened-once latch — a promise gate, never a timer. */
function latch(): { opened: Promise<void>; open: () => void } {
  const box = { open: (): void => undefined };
  const opened = new Promise<void>((resolve) => {
    box.open = resolve;
  });
  return { opened, open: () => box.open() };
}

/**
 * Two writes, interleaved on purpose. The FIRST is held between its reads and
 * its first write; the SECOND is started and allowed to reach the lock (or,
 * with locks off, its own first write); then the first is let go.
 */
async function interleave(
  fake: { rowLocks: boolean; derive: boolean },
  run: (h: TestHost) => { first: () => Promise<RbacResponse>; second: () => Promise<RbacResponse> },
): Promise<{ h: TestHost; statuses: number[] }> {
  const control = { armed: false, held: null as number | null };
  const firstHeld = latch();
  const letFirstGo = latch();
  const secondArrived = latch();
  const h = await host(TWO_OWNERS, {
    rowLocks: fake.rowLocks,
    ...(fake.derive ? { deriveMembershipRole: deriveByRank } : {}),
    beforeWrite: async (_op, txId) => {
      if (!control.armed) return;
      control.held ??= txId;
      if (txId !== control.held) {
        secondArrived.open();
        return;
      }
      firstHeld.open();
      await letFirstGo.opened;
    },
    onLockWait: (txId) => {
      if (control.armed && txId !== control.held) secondArrived.open();
    },
  });
  const { first, second } = run(h);
  control.armed = true;
  const a = first().finally(firstHeld.open);
  await firstHeld.opened;
  const b = second().finally(secondArrived.open);
  await secondArrived.opened;
  letFirstGo.open();
  const responses = await Promise.all([a, b]);
  return { h, statuses: responses.map((r) => r.status) };
}

const PAIRS: Record<string, (h: TestHost) => { first: () => Promise<RbacResponse>; second: () => Promise<RbacResponse> }> = {
  'revoke × revoke': (h) => ({
    first: () => call(h, REVOKE, { actor: memberActor(TENANT, 'owner-1'), params: { userId: 'owner-2', role: 'DIRECTOR' } }),
    second: () => call(h, REVOKE, { actor: memberActor(TENANT, 'owner-2'), params: { userId: 'owner-1', role: 'DIRECTOR' } }),
  }),
  'two platform removals': (h) => ({
    first: () => call(h, REMOVE, { actor: superActor(TENANT), params: { userId: 'owner-1' } }),
    second: () => call(h, REMOVE, { actor: superActor(TENANT), params: { userId: 'owner-2' } }),
  }),
  'revoke × removal': (h) => ({
    first: () => call(h, REVOKE, { actor: memberActor(TENANT, 'owner-1'), params: { userId: 'owner-2', role: 'DIRECTOR' } }),
    second: () => call(h, REMOVE, { actor: memberActor(TENANT, 'owner-2'), params: { userId: 'owner-1' } }),
  }),
};

describe('l3: two co-owners taking ownership from each other at once', () => {
  for (const [name, pair] of Object.entries(PAIRS)) {
    for (const derive of [false, true]) {
      const kind = derive ? 'a deriving host' : 'a verbatim host';
      it(`${name}, on ${kind}: one owner remains and one write is refused`, async () => {
        const { h, statuses } = await interleave({ rowLocks: true, derive }, pair);
        expect(countedOwners(h.state)).toHaveLength(1);
        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(statuses.filter((status) => status === 403 || status === 409)).toHaveLength(1);
      });

      it(`${name}, on ${kind}, WITHOUT the lock: both pass and nobody owns the tenant`, async () => {
        const { h, statuses } = await interleave({ rowLocks: false, derive }, pair);
        expect(statuses).toEqual([200, 200]);
        expect(countedOwners(h.state)).toEqual([]);
      });
    }
  }
});
