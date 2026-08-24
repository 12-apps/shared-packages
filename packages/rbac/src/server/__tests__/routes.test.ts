import { describe, expect, it } from 'vitest';

import type { RbacRequest, RbacResponse, RbacRoute } from '../context';

import { EN_US_RBAC_MESSAGES } from '../en-US';
import { PT_BR_RBAC_MESSAGES } from '../pt-BR';
import { enrolMember, seedRole } from './fake-db';
import { createTestHost, memberActor, superActor, type TestHost } from './server-fixtures';

/**
 * The route descriptors end-to-end over the in-memory seam (12-13) — the
 * package port of the origin host's roles/team route tests plus the
 * `rbac-roles-per-tenant` / `team-role-assignment` integration behaviors:
 * governance rejections, owner invariants, tenant scoping, idempotent grants.
 */

const TENANT = 'tenant-a';

async function host(): Promise<TestHost> {
  const built = createTestHost();
  await built.api.seedTenantRoles(TENANT);
  return built;
}

function route(h: TestHost, method: string, path: string): RbacRoute {
  const found = h.api.routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found;
}

function call(
  h: TestHost,
  method: string,
  path: string,
  request: Partial<RbacRequest> & { actor: RbacRequest['actor'] },
): Promise<RbacResponse> {
  return route(h, method, path).handle({
    params: {},
    query: {},
    ...request,
  });
}

const data = (response: RbacResponse): Record<string, unknown> =>
  (response.body as { data: Record<string, unknown> }).data;

describe('roles routes', () => {
  it('lists the seeded catalog for a DIRECTOR, newest catalog first by name', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const response = await call(h, 'GET', '/roles', { actor: memberActor(TENANT, 'owner-1') });
    expect(response.status).toBe(200);
    const body = response.body as { data: { name: string; kind: string }[]; pagination: object };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((row) => row.kind === 'SYSTEM')).toBe(true);
    expect(body.pagination).toMatchObject({ page: 1 });
  });

  it('denies the list to a CLERK (roles:manage gate) with 403', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'waiter-1', 'CLERK');
    const response = await call(h, 'GET', '/roles', { actor: memberActor(TENANT, 'waiter-1') });
    expect(response.status).toBe(403);
  });

  it('creates a custom role, then filters it by q', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const created = await call(h, 'POST', '/roles', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { name: 'Voluntário', description: 'Ajuda no balcão', permissions: ['titles:read:all'] },
    });
    expect(created.status).toBe(200);
    expect(data(created)).toMatchObject({ name: 'Voluntário', permissions: ['titles:read:all'] });

    const filtered = await call(h, 'GET', '/roles', {
      actor: memberActor(TENANT, 'owner-1'),
      query: { q: 'volunt' },
    });
    const body = filtered.body as { data: { name: string }[] };
    expect(body.data.map((row) => row.name)).toEqual(['Voluntário']);
  });

  it('409s a duplicate and a template-reserved name', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const actor = memberActor(TENANT, 'owner-1');
    const body = { name: 'Voluntário', permissions: ['titles:read:all'] };
    await call(h, 'POST', '/roles', { actor, body });
    const duplicate = await call(h, 'POST', '/roles', { actor, body });
    expect(duplicate.status).toBe(409);
    const reserved = await call(h, 'POST', '/roles', {
      actor,
      body: { name: 'CLERK', permissions: ['titles:read:all'] },
    });
    expect(reserved.status).toBe(409);
  });

  it('governance blocks a HEAD_LIBRARIAN composing a role above their own ceiling', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'admin-1', 'HEAD_LIBRARIAN');
    // `budget:manage` is an owner-marker — always blocked, whatever the
    // granter's own template happens to enumerate.
    const response = await call(h, 'POST', '/roles', {
      actor: memberActor(TENANT, 'admin-1'),
      body: { name: 'Escalado', permissions: ['budget:manage'] },
    });
    expect(response.status).toBe(400);
    // The denial was reported to the audit sink.
    expect(h.audits.some((entry) => entry.action === 'governance.reject')).toBe(true);
  });

  it('updates and deletes a custom role; a foreign tenant sees 404', async () => {
    const h = await host();
    await h.api.seedTenantRoles('tenant-b');
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    enrolMember(h.state, 'tenant-b', 'owner-2', 'DIRECTOR');
    const actor = memberActor(TENANT, 'owner-1');
    const created = await call(h, 'POST', '/roles', {
      actor,
      body: { name: 'Voluntário', permissions: ['titles:read:all'] },
    });
    const id = data(created).id as string;

    const foreign = await call(h, 'PATCH', '/roles/:id', {
      actor: memberActor('tenant-b', 'owner-2'),
      params: { id },
      body: { name: 'Roubo', permissions: ['titles:read:all'] },
    });
    expect(foreign.status).toBe(404);

    const updated = await call(h, 'PATCH', '/roles/:id', {
      actor,
      params: { id },
      body: { name: 'Voluntário Sênior', permissions: ['titles:read:all', 'copies:read'] },
    });
    expect(updated.status).toBe(200);
    expect(data(updated)).toMatchObject({ name: 'Voluntário Sênior' });

    const deleted = await call(h, 'DELETE', '/roles/:id', { actor, params: { id } });
    expect(deleted.status).toBe(200);
    expect(data(deleted)).toEqual({ status: 'deleted' });
  });

  it('DELETE archives the role: grants stop, the row survives, repeat is 404', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    // CLERK's own template does not carry copies:read, so the assertion below
    // can only be satisfied by the custom grant — and only fail through it.
    enrolMember(h.state, TENANT, 'waiter-1', 'CLERK');
    const actor = memberActor(TENANT, 'owner-1');
    const created = await call(h, 'POST', '/roles', {
      actor,
      body: { name: 'Voluntário', permissions: ['copies:read'] },
    });
    const id = data(created).id as string;
    await call(h, 'POST', '/team/:userId/roles', {
      actor,
      params: { userId: 'waiter-1' },
      body: { role: 'Voluntário' },
    });
    const before = await h.api.guards.getActorPermissions(
      { userId: 'waiter-1', isSuper: false },
      TENANT,
    );
    expect(before.has('copies:read')).toBe(true);

    const deleted = await call(h, 'DELETE', '/roles/:id', { actor, params: { id } });
    expect(deleted.status).toBe(200);

    // Deny-by-default: the archived role stops granting at once…
    const perms = await h.api.guards.getActorPermissions(
      { userId: 'waiter-1', isSuper: false },
      TENANT,
    );
    expect(perms.has('copies:read')).toBe(false);
    // …but the row and the member's link SURVIVE (an archive, not a cascade) —
    // one UPDATE away from restore instead of gone (12-17's surface).
    const row = h.state.roles.find((candidate) => candidate.id === id);
    expect(row?.archivedAt).not.toBeNull();
    expect(h.state.membershipRoles.some((link) => link.roleId === id)).toBe(true);
    // Gone from the grid, and a second delete is a 404, not a double-archive.
    const listed = await call(h, 'GET', '/roles', { actor });
    expect(
      (listed.body as { data: { id: string }[] }).data.some((r) => r.id === id),
    ).toBe(false);
    const again = await call(h, 'DELETE', '/roles/:id', { actor, params: { id } });
    expect(again.status).toBe(404);
  });

  it('overrides a template per-tenant and resets it to the seed default', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const actor = memberActor(TENANT, 'owner-1');
    const narrowed = await call(h, 'PUT', '/roles/templates/:name', {
      actor,
      params: { name: 'CLERK' },
      body: { permissions: ['loans:read:assigned'] },
    });
    expect(narrowed.status).toBe(200);
    expect(data(narrowed)).toMatchObject({
      name: 'CLERK',
      permissions: ['loans:read:assigned'],
    });

    // The override changes what the role GRANTS at runtime.
    enrolMember(h.state, TENANT, 'waiter-1', 'CLERK');
    const perms = await h.api.guards.getActorPermissions(
      { userId: 'waiter-1', isSuper: false },
      TENANT,
    );
    expect([...perms]).toEqual(['loans:read:assigned']);

    const reset = await call(h, 'DELETE', '/roles/templates/:name', {
      actor,
      params: { name: 'CLERK' },
    });
    expect(reset.status).toBe(200);
    expect(data(reset)).toEqual({ status: 'reset' });
    const restored = await h.api.guards.getActorPermissions(
      { userId: 'waiter-1', isSuper: false },
      TENANT,
    );
    expect(restored.size).toBeGreaterThan(1);
  });

  /** Narrow HEAD_LIBRARIAN to a set that still carries the route's own `roles:manage`. */
  async function withheldPayouts(h: TestHost): Promise<void> {
    const narrowed = await call(h, 'PUT', '/roles/templates/:name', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { name: 'HEAD_LIBRARIAN' },
      // `roles:manage` stays, so the HEAD_LIBRARIAN still reaches the reset route at
      // all — what happens once they do is the whole point.
      body: { permissions: ['roles:manage', 'team:read', 'config:read'] },
    });
    expect(narrowed.status).toBe(200);
  }

  it('refuses a reset that would restore a permission the resetter lacks', async () => {
    // Reset WRITES the seeded set into the tenant's live row, so it is an
    // override and is governed like one. Narrowing a system template through
    // the governed PUT is the only mechanism the product offers an owner for
    // withholding a permission from an administrator; while the reset ran no
    // governance, the HEAD_LIBRARIAN could throw that narrowing away and restore the
    // code's seed — handing their OWN role back exactly what the owner removed,
    // as often as the owner re-narrowed it.
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    enrolMember(h.state, TENANT, 'admin-1', 'HEAD_LIBRARIAN');
    await withheldPayouts(h);

    const reset = await call(h, 'DELETE', '/roles/templates/:name', {
      actor: memberActor(TENANT, 'admin-1'),
      params: { name: 'HEAD_LIBRARIAN' },
    });
    expect(reset.status).toBe(400);
    // The ESCALATION guard is what refused — not owner-protection, not SoD,
    // not UNKNOWN_ROLE. Any of those refusing for the wrong reason would leave
    // the escalation path untested.
    expect(
      h.audits.filter(
        (entry) =>
          entry.action === 'governance.reject' &&
          (entry.after as { code?: string } | undefined)?.code === 'ESCALATION',
      ),
    ).toHaveLength(1);
    // The owner's narrowing SURVIVES — the row was never rewritten.
    const perms = await h.api.guards.getActorPermissions(
      { userId: 'admin-1', isSuper: false },
      TENANT,
    );
    expect([...perms].sort()).toEqual(['config:read', 'roles:manage', 'team:read']);
  });

  it('still lets a DIRECTOR reset a narrowed template back to the seed', async () => {
    // The legitimate path: DIRECTOR/NETWORK_OPS hold '*', so escalation is
    // satisfied and the governed reset behaves exactly as it always did.
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    enrolMember(h.state, TENANT, 'admin-1', 'HEAD_LIBRARIAN');
    await withheldPayouts(h);

    const reset = await call(h, 'DELETE', '/roles/templates/:name', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { name: 'HEAD_LIBRARIAN' },
    });
    expect(reset.status).toBe(200);
    expect(data(reset)).toEqual({ status: 'reset' });
    const perms = await h.api.guards.getActorPermissions(
      { userId: 'admin-1', isSuper: false },
      TENANT,
    );
    expect(perms.has('budget:manage')).toBe(true);
    expect(h.audits.some((entry) => entry.action === 'governance.reject')).toBe(false);
  });

  it('a reset with nothing to restore is still an idempotent reset', async () => {
    // The route's contract: a no-op answers `reset`. Governance must not turn
    // a second (or a never-overridden) reset into a refusal.
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const actor = memberActor(TENANT, 'owner-1');
    const untouched = await call(h, 'DELETE', '/roles/templates/:name', {
      actor,
      params: { name: 'HEAD_LIBRARIAN' },
    });
    expect(untouched.status).toBe(200);
    expect(data(untouched)).toEqual({ status: 'reset' });
    const again = await call(h, 'DELETE', '/roles/templates/:name', {
      actor,
      params: { name: 'HEAD_LIBRARIAN' },
    });
    expect(again.status).toBe(200);
    expect(data(again)).toEqual({ status: 'reset' });
  });

  it('rejects overriding an owner template by name', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const response = await call(h, 'PUT', '/roles/templates/:name', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { name: 'DIRECTOR' },
      body: { permissions: ['titles:read:all'] },
    });
    expect(response.status).toBe(400);
  });

  it('GET /permissions answers the caller own set (staff only)', async () => {
    const h = await host();
    enrolMember(h.state, TENANT, 'manager-1', 'BRANCH_LEAD');
    enrolMember(h.state, TENANT, 'shopper-1', 'PATRON');
    const managers = await call(h, 'GET', '/permissions', {
      actor: memberActor(TENANT, 'manager-1'),
    });
    expect(managers.status).toBe(200);
    const payload = data(managers) as { permissions: string[] };
    expect(payload.permissions).toContain('titles:write');
    expect(payload.permissions).not.toContain('roles:manage');

    const shopper = await call(h, 'GET', '/permissions', {
      actor: memberActor(TENANT, 'shopper-1'),
    });
    expect(shopper.status).toBe(403);
  });

  it('merges permissionsExtras into the shell read', async () => {
    const h = createTestHost({
      permissionsExtras: async () => ({ entitlements: { plan: 'pro' } }),
    });
    await h.api.seedTenantRoles(TENANT);
    enrolMember(h.state, TENANT, 'manager-1', 'BRANCH_LEAD');
    const response = await call(h, 'GET', '/permissions', {
      actor: memberActor(TENANT, 'manager-1'),
    });
    expect(data(response)).toMatchObject({ entitlements: { plan: 'pro' } });
  });
});

describe('team routes', () => {
  async function teamHost(): Promise<TestHost> {
    const h = await host();
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    enrolMember(h.state, TENANT, 'chef-1', 'CONSERVATOR');
    enrolMember(h.state, TENANT, 'shopper-1', 'PATRON');
    h.directory.set('owner-1', {
      id: 'owner-1',
      email: 'owner@example.com',
      name: 'Ana Owner',
      image: null,
    });
    h.directory.set('chef-1', {
      id: 'chef-1',
      email: 'chef@example.com',
      name: 'Camila Barbosa',
      image: null,
    });
    return h;
  }

  it('lists the staff roster (customers excluded) with identity joined', async () => {
    const h = await teamHost();
    const response = await call(h, 'GET', '/team', { actor: memberActor(TENANT, 'owner-1') });
    expect(response.status).toBe(200);
    const body = response.body as { data: { userId: string; email: string }[] };
    expect(body.data.map((row) => row.userId).sort()).toEqual(['chef-1', 'owner-1']);
    expect(body.data.find((row) => row.userId === 'chef-1')?.email).toBe('chef@example.com');
  });

  it('narrows the roster by q through the directory seam', async () => {
    const h = await teamHost();
    const response = await call(h, 'GET', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      query: { q: 'Camila' },
    });
    const body = response.body as { data: { userId: string }[] };
    expect(body.data.map((row) => row.userId)).toEqual(['chef-1']);
  });

  it('denies the roster to a CONSERVATOR (admin tier) with 403', async () => {
    const h = await teamHost();
    const response = await call(h, 'GET', '/team', { actor: memberActor(TENANT, 'chef-1') });
    expect(response.status).toBe(403);
  });

  it('reassigns a member base role and preserves additive custom roles', async () => {
    const h = await teamHost();
    const actor = memberActor(TENANT, 'owner-1');
    seedRole(h.state, { clientId: TENANT, name: 'Voluntário', permissions: ['titles:read:all'] });
    const granted = await call(h, 'POST', '/team/:userId/roles', {
      actor,
      params: { userId: 'chef-1' },
      body: { role: 'Voluntário' },
    });
    expect(granted.status).toBe(200);

    const reassigned = await call(h, 'PATCH', '/team/:userId', {
      actor,
      params: { userId: 'chef-1' },
      body: { role: 'BRANCH_LEAD' },
    });
    expect(reassigned.status).toBe(200);
    expect(data(reassigned)).toEqual({ status: 'updated', role: 'BRANCH_LEAD' });

    const detail = await call(h, 'GET', '/team/:userId', {
      actor,
      params: { userId: 'chef-1' },
    });
    expect(data(detail)).toMatchObject({ role: 'BRANCH_LEAD', customRoles: ['Voluntário'] });

    // The member's effective permissions now come from BRANCH_LEAD + Voluntário.
    const perms = await h.api.guards.getActorPermissions(
      { userId: 'chef-1', isSuper: false },
      TENANT,
    );
    expect(perms.has('titles:write')).toBe(true);
  });

  it('grant is idempotent and revoke removes only the named role', async () => {
    const h = await teamHost();
    const actor = memberActor(TENANT, 'owner-1');
    seedRole(h.state, { clientId: TENANT, name: 'Voluntário', permissions: ['titles:read:all'] });
    await call(h, 'POST', '/team/:userId/roles', {
      actor,
      params: { userId: 'chef-1' },
      body: { role: 'Voluntário' },
    });
    await call(h, 'POST', '/team/:userId/roles', {
      actor,
      params: { userId: 'chef-1' },
      body: { role: 'Voluntário' },
    });
    // One grant audit despite two calls (the idempotent no-op is silent).
    expect(h.audits.filter((entry) => entry.action === 'team.role_grant')).toHaveLength(1);

    const revoked = await call(h, 'DELETE', '/team/:userId/roles/:role', {
      actor,
      params: { userId: 'chef-1', role: 'Voluntário' },
    });
    expect(data(revoked)).toEqual({ status: 'revoked' });
    const detail = await call(h, 'GET', '/team/:userId', {
      actor,
      params: { userId: 'chef-1' },
    });
    expect(data(detail)).toMatchObject({ role: 'CONSERVATOR', customRoles: [] });
  });

  it('granting an unknown role is a 400 governance rejection (UNKNOWN_ROLE)', async () => {
    // Governance runs BEFORE the store, exactly as the origin host route did —
    // an unknown name never reaches the write path.
    const h = await teamHost();
    const response = await call(h, 'POST', '/team/:userId/roles', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'chef-1' },
      body: { role: 'Fantasma' },
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toBe('Papel desconhecido.');
  });

  it('never demotes the last DIRECTOR and never disables a DIRECTOR', async () => {
    const h = await teamHost();
    const actor = memberActor(TENANT, 'owner-1');
    const demoted = await call(h, 'PATCH', '/team/:userId', {
      actor,
      params: { userId: 'owner-1' },
      body: { role: 'BRANCH_LEAD' },
    });
    expect(demoted.status).toBe(409);

    const disabled = await call(h, 'PATCH', '/team/:userId/status', {
      actor,
      params: { userId: 'owner-1' },
      body: { active: false },
    });
    expect(disabled.status).toBe(403);
  });

  it('disable revokes access and re-enable restores it', async () => {
    const h = await teamHost();
    const actor = memberActor(TENANT, 'owner-1');
    const disabled = await call(h, 'PATCH', '/team/:userId/status', {
      actor,
      params: { userId: 'chef-1' },
      body: { active: false },
    });
    expect(disabled.status).toBe(200);
    const off = await h.api.guards.getActorPermissions(
      { userId: 'chef-1', isSuper: false },
      TENANT,
    );
    expect(off.size).toBe(0);

    await call(h, 'PATCH', '/team/:userId/status', {
      actor,
      params: { userId: 'chef-1' },
      body: { active: true },
    });
    const on = await h.api.guards.getActorPermissions(
      { userId: 'chef-1', isSuper: false },
      TENANT,
    );
    expect(on.size).toBeGreaterThan(0);
  });

  it('removes a member and clears their tenant-scoped grants', async () => {
    const h = await teamHost();
    const actor = memberActor(TENANT, 'owner-1');
    h.state.roleAssignments.push({
      id: 'ra-1',
      userId: 'chef-1',
      roleName: 'Voluntário',
      scope: TENANT,
    });
    const removed = await call(h, 'DELETE', '/team/:userId', {
      actor,
      params: { userId: 'chef-1' },
    });
    expect(data(removed)).toEqual({ status: 'removed' });
    expect(h.state.memberships.some((row) => row.userId === 'chef-1')).toBe(false);
    expect(h.state.roleAssignments.some((row) => row.userId === 'chef-1')).toBe(false);
  });

  it('a soft-disabled DIRECTOR/HEAD_LIBRARIAN loses the roster tier entirely', async () => {
    // BLOCKER-1 regression: "Desativar" is the reversible revocation, and the
    // tier gates are exactly the access it must revoke. A disabled DIRECTOR —
    // whose permissions already resolve to nothing — must not keep the roster
    // read, the invite port or the destructive member removal.
    const h = await teamHost();
    enrolMember(h.state, TENANT, 'owner-2', 'DIRECTOR');
    const disable = h.state.memberships.find((row) => row.userId === 'owner-2');
    if (disable) disable.active = false;
    const actor = memberActor(TENANT, 'owner-2');

    const roster = await call(h, 'GET', '/team', { actor });
    expect(roster.status).toBe(403);
    const removed = await call(h, 'DELETE', '/team/:userId', {
      actor,
      params: { userId: 'chef-1' },
    });
    expect(removed.status).toBe(403);
    const invited = await call(h, 'POST', '/team', {
      actor,
      body: { email: 'accomplice@example.com' },
    });
    expect(invited.status).toBe(403);
    // The member they aimed at is untouched.
    expect(h.state.memberships.some((row) => row.userId === 'chef-1')).toBe(true);
  });

  it('a soft-disabled member loses the staff tier (GET /permissions is 403)', async () => {
    const h = await teamHost();
    const disable = h.state.memberships.find((row) => row.userId === 'chef-1');
    if (disable) disable.active = false;
    const response = await call(h, 'GET', '/permissions', {
      actor: memberActor(TENANT, 'chef-1'),
    });
    expect(response.status).toBe(403);
  });

  it('a base role outside assignableBaseRoles is the wire 400, custom roles included', async () => {
    // MAJOR-7: the base role is a CLOSED set. A tenant custom role is
    // additive by design — on the origin host's DB this write would hit the
    // memberships_role_check CHECK and 500; the package answers the wire's
    // 400 before governance ever runs.
    const h = await teamHost();
    seedRole(h.state, { clientId: TENANT, name: 'Voluntário', permissions: ['copies:read'] });
    const custom = await call(h, 'PATCH', '/team/:userId', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'chef-1' },
      body: { role: 'Voluntário' },
    });
    expect(custom.status).toBe(400);

    const narrowed = createTestHost({ assignableBaseRoles: ['CLERK'] });
    await narrowed.api.seedTenantRoles(TENANT);
    enrolMember(narrowed.state, TENANT, 'owner-1', 'DIRECTOR');
    enrolMember(narrowed.state, TENANT, 'chef-1', 'CONSERVATOR');
    const outside = await call(narrowed, 'PATCH', '/team/:userId', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'chef-1' },
      body: { role: 'BRANCH_LEAD' },
    });
    expect(outside.status).toBe(400);
    const inside = await call(narrowed, 'PATCH', '/team/:userId', {
      actor: memberActor(TENANT, 'owner-1'),
      params: { userId: 'chef-1' },
      body: { role: 'CLERK' },
    });
    expect(inside.status).toBe(200);
  });

  it('the DEFAULT assignable set excludes every governance owner role', async () => {
    // Delta re-review MINOR-A: the default must be derived from
    // governance.ownerRoles (DIRECTOR + NETWORK_OPS), not the disable-invariant
    // ownerRoles knob — this layer exists to refuse BEFORE governance, so the
    // refusal must be the wire 400 with governance never reached (no
    // governance.reject audit entry).
    const h = await teamHost();
    for (const role of ['DIRECTOR', 'NETWORK_OPS']) {
      const response = await call(h, 'PATCH', '/team/:userId', {
        actor: memberActor(TENANT, 'owner-1'),
        params: { userId: 'chef-1' },
        body: { role },
      });
      expect(response.status).toBe(400);
    }
    expect(h.audits).toEqual([]);
  });

  it('a route-level permission ceiling narrows the whole surface', async () => {
    const h = await teamHost();
    const actor = {
      ...memberActor(TENANT, 'owner-1'),
      permissionCeiling: new Set(['titles:read:all']),
    };
    // roles:manage falls outside the ceiling → the roles surface is gone.
    const roles = await call(h, 'GET', '/roles', { actor });
    expect(roles.status).toBe(403);
    // The shell read still answers, narrowed to the intersection.
    const permissions = await call(h, 'GET', '/permissions', { actor });
    expect(permissions.status).toBe(200);
    expect((data(permissions) as { permissions: string[] }).permissions).toEqual([
      'titles:read:all',
    ]);
  });

  it('every write reports its audit action through the fenced sink', async () => {
    // MINOR-13: pins the whole action vocabulary, and MAJOR-6's fence — the
    // sink here THROWS on every call, and no write may care.
    const h = createTestHost({
      audit: () => {
        throw new Error('sink down');
      },
    });
    await h.api.seedTenantRoles(TENANT);
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    enrolMember(h.state, TENANT, 'chef-1', 'CONSERVATOR');
    const actor = memberActor(TENANT, 'owner-1');
    const created = await call(h, 'POST', '/roles', {
      actor,
      body: { name: 'Voluntário', permissions: ['copies:read'] },
    });
    expect(created.status).toBe(200);

    const audited = await teamHost();
    const auditedActor = memberActor(TENANT, 'owner-1');
    const id = data(
      await call(audited, 'POST', '/roles', {
        actor: auditedActor,
        body: { name: 'Voluntário', permissions: ['copies:read'] },
      }),
    ).id as string;
    await call(audited, 'PATCH', '/roles/:id', {
      actor: auditedActor,
      params: { id },
      body: { name: 'Voluntário', permissions: ['copies:read', 'titles:read:all'] },
    });
    await call(audited, 'POST', '/team/:userId/roles', {
      actor: auditedActor,
      params: { userId: 'chef-1' },
      body: { role: 'Voluntário' },
    });
    await call(audited, 'DELETE', '/team/:userId/roles/:role', {
      actor: auditedActor,
      params: { userId: 'chef-1', role: 'Voluntário' },
    });
    await call(audited, 'DELETE', '/roles/:id', { actor: auditedActor, params: { id } });
    await call(audited, 'PATCH', '/team/:userId', {
      actor: auditedActor,
      params: { userId: 'chef-1' },
      body: { role: 'BRANCH_LEAD' },
    });
    await call(audited, 'PATCH', '/team/:userId/status', {
      actor: auditedActor,
      params: { userId: 'chef-1' },
      body: { active: false },
    });
    await call(audited, 'PATCH', '/team/:userId/status', {
      actor: auditedActor,
      params: { userId: 'chef-1' },
      body: { active: true },
    });
    await call(audited, 'DELETE', '/team/:userId', {
      actor: auditedActor,
      params: { userId: 'chef-1' },
    });
    enrolMember(audited.state, TENANT, 'admin-2', 'HEAD_LIBRARIAN');
    await call(audited, 'POST', '/roles', {
      actor: memberActor(TENANT, 'admin-2'),
      body: { name: 'Golpe', permissions: ['budget:manage'] },
    });
    const actions = audited.audits.map((entry) => entry.action);
    for (const expected of [
      'role.create',
      'role.update',
      'role.delete',
      'team.role_set',
      'team.role_grant',
      'team.role_revoke',
      'team.member_status',
      'team.member_remove',
      'governance.reject',
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it('the invites port reports team.invite / team.invite_cancel', async () => {
    const h = createTestHost({
      invites: {
        invite: async () => ({ status: 'invited' as const }),
        listPending: async () => [],
        cancel: async () => undefined,
      },
    });
    await h.api.seedTenantRoles(TENANT);
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const actor = memberActor(TENANT, 'owner-1');
    await call(h, 'POST', '/team', { actor, body: { email: 'novo@example.com' } });
    await call(h, 'DELETE', '/team/invites/:inviteId', {
      actor,
      params: { inviteId: 'i1' },
    });
    expect(h.audits.map((entry) => entry.action)).toEqual([
      'team.invite',
      'team.invite_cancel',
    ]);
    expect(h.audits[0]).toMatchObject({ resourceId: 'novo@example.com' });
  });

  it('a platform admin reaches the roster with no membership', async () => {
    const h = await teamHost();
    const response = await call(h, 'GET', '/team', { actor: superActor(TENANT) });
    expect(response.status).toBe(200);
  });

  it('team context lists assignable roles and invitesEnabled=false without the port', async () => {
    const h = await teamHost();
    seedRole(h.state, { clientId: TENANT, name: 'Voluntário', permissions: ['titles:read:all'] });
    const response = await call(h, 'GET', '/team/context', {
      actor: memberActor(TENANT, 'owner-1'),
    });
    const payload = data(response) as {
      assignableRoles: string[];
      invitesEnabled: boolean;
      pendingInvites: unknown[];
    };
    expect(payload.assignableRoles).toContain('Voluntário');
    expect(payload.assignableRoles).toContain('CLERK');
    expect(payload.assignableRoles).not.toContain('DIRECTOR');
    expect(payload.invitesEnabled).toBe(false);
    expect(payload.pendingInvites).toEqual([]);
  });

  it('POST /team answers 501 without the invites port and works with it', async () => {
    const h = await teamHost();
    const without = await call(h, 'POST', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { email: 'novo@example.com' },
    });
    expect(without.status).toBe(501);

    const invites: { email: string }[] = [];
    const withPort = createTestHost({
      invites: {
        invite: async (_tenantId, email) => {
          invites.push({ email });
          return { status: 'invited' as const };
        },
        listPending: async () => [{ id: 'i1', email: 'novo@example.com', role: 'HEAD_LIBRARIAN' }],
        cancel: async () => undefined,
      },
    });
    await withPort.api.seedTenantRoles(TENANT);
    enrolMember(withPort.state, TENANT, 'owner-1', 'DIRECTOR');
    const response = await call(withPort, 'POST', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { email: 'novo@example.com' },
    });
    expect(data(response)).toEqual({ status: 'invited' });
    expect(invites).toEqual([{ email: 'novo@example.com' }]);
  });
});

describe('one mount, two languages', () => {
  /**
   * The property the resolver form of the copy port exists for. rbac has THREE
   * layers that are each built once per process — the route table, the team
   * store and the roles store — plus the guards, which the host also calls
   * directly. A resolver wired into one of them answers a refusal in the
   * reader's language and the next one in the deployment's, on the same screen.
   *
   * So the cases below cover a ROUTE refusal and a STORE refusal separately.
   */
  const bilingual = (): TestHost =>
    createTestHost({
      // The shape `@12-apps/i18n`'s `localeCopy(PACK)` returns, spelled out so
      // this package keeps no dependency on it.
      messages: ({ locale }) =>
        locale === 'en-US' ? EN_US_RBAC_MESSAGES : PT_BR_RBAC_MESSAGES,
    });

  const errorOf = (response: RbacResponse): string =>
    (response.body as { error: string }).error;

  it('answers a ROUTE refusal in each caller’s language', async () => {
    // A member with no admin role — `requireAdminTier`, in the routes layer.
    const h = bilingual();
    const actor = memberActor(TENANT, 'u-nobody');
    const pt = await call(h, 'GET', '/team', { actor, locale: 'pt-BR' });
    const en = await call(h, 'GET', '/team', { actor, locale: 'en-US' });
    expect(errorOf(pt)).toBe(PT_BR_RBAC_MESSAGES.forbidden);
    expect(errorOf(en)).toBe(EN_US_RBAC_MESSAGES.forbidden);
  });

  it('carries the locale past the routes, into a store built at boot', async () => {
    // Setting the role of somebody who is not a member. The actor IS permitted
    // and the route's own checks all pass, so the refusal is thrown INSIDE
    // `createTeamStore` — a store constructed once per process, and therefore
    // the layer a routes-only adoption would leave answering the language the
    // process started with.
    //
    // Deliberately not a 404 the ROUTE decides (a stale role id, say): that
    // would look like this and prove nothing about the store.
    const h = bilingual();
    await h.api.seedTenantRoles(TENANT);
    enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
    const actor = memberActor(TENANT, 'owner-1');
    const body = { role: 'HEAD_LIBRARIAN' };

    const pt = await call(h, 'PATCH', '/team/:userId', {
      actor,
      params: { userId: 'nao-e-membro' },
      body,
      locale: 'pt-BR',
    });
    const en = await call(h, 'PATCH', '/team/:userId', {
      actor,
      params: { userId: 'nao-e-membro' },
      body,
      locale: 'en-US',
    });
    expect(pt.status).toBe(404);
    expect(errorOf(pt)).toBe(PT_BR_RBAC_MESSAGES.notAMember);
    expect(errorOf(en)).toBe(EN_US_RBAC_MESSAGES.notAMember);
  });

  it('hands an absent locale to the resolver rather than refusing', async () => {
    // A host with one audience populates nothing. The resolver decides what no
    // answer means, and here it means the default.
    const h = bilingual();
    const response = await call(h, 'GET', '/team', { actor: memberActor(TENANT, 'u-nobody') });
    expect(errorOf(response)).toBe(PT_BR_RBAC_MESSAGES.forbidden);
  });

  it('leaves a plain-value host byte-identical', async () => {
    // The whole compatibility claim: words rather than a resolver behaves
    // exactly as before the field widened.
    const h = createTestHost();
    const response = await call(h, 'GET', '/team', {
      actor: memberActor(TENANT, 'u-nobody'),
      locale: 'en-US',
    });
    expect(errorOf(response)).toBe(PT_BR_RBAC_MESSAGES.forbidden);
  });
});
