import { describe, expect, it } from 'vitest';

import type { RbacActor, RbacRequest, RbacResponse, RbacRoute } from '../context';
import { PT_BR_RBAC_MESSAGES } from '../pt-BR';
import { enrolMember, seedRole, type FakeRbacState } from './fake-db';
import { createTestHost, memberActor, type TestHost } from './server-fixtures';

/**
 * The Equipe API's outer boundary is a PERMISSION, never a tier (FUT-3661).
 *
 * Reads ask `team:read`, writes `team:manage`. The membership tier is still
 * READ where the owner rules need it, and no longer refuses on its own: there
 * is no `adminRoles` list left to be outside of. In the demo catalog,
 * BRANCH_LEAD plays the origin host's MANAGER (holds `team:read`, not
 * `team:manage`), HEAD_LIBRARIAN its ADMIN and CLERK its WAITER.
 */

const TENANT = 'tenant-a';

type Call = readonly [method: string, path: string, request?: Partial<RbacRequest>];

const READS: readonly Call[] = [
  ['GET', '/team'],
  ['GET', '/team/context'],
  ['GET', '/team/:userId', { params: { userId: 'clerk-2' } }],
];

const WRITES: readonly Call[] = [
  ['POST', '/team', { body: { email: 'novo@example.com' } }],
  ['DELETE', '/team/invites/:inviteId', { params: { inviteId: 'i1' } }],
  ['POST', '/team/invites/:inviteId/resend', { params: { inviteId: 'i1' } }],
  ['PATCH', '/team/:userId/status', { params: { userId: 'clerk-2' }, body: { active: false } }],
  ['DELETE', '/team/:userId', { params: { userId: 'clerk-2' } }],
];

function route(h: TestHost, method: string, path: string): RbacRoute {
  const found = h.api.routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found;
}

function call(h: TestHost, [method, path, request]: Call, actor: RbacActor): Promise<RbacResponse> {
  return route(h, method, path).handle({ params: {}, query: {}, ...request, actor });
}

/** Link one more role row to an existing membership (an additive grant). */
function linkRole(state: FakeRbacState, userId: string, roleName: string): void {
  const membership = state.memberships.find((m) => m.userId === userId && m.clientId === TENANT);
  const role = state.roles.find((r) => r.clientId === TENANT && r.name === roleName);
  if (!membership || !role) throw new Error(`Cannot link ${roleName} to ${userId}`);
  state.membershipRoles.push({
    id: `link-${userId}-${roleName}`,
    membershipId: membership.id,
    roleId: role.id,
  });
}

/** A host with the invites port bound, so a write that is admitted answers 2xx. */
async function host(): Promise<{ h: TestHost; invited: string[] }> {
  const invited: string[] = [];
  const h = createTestHost({
    invites: {
      invite: async (_tenantId, email) => {
        invited.push(email);
        return { status: 'invited' as const };
      },
      listPending: async () => [],
      cancel: async () => undefined,
      resend: async () => ({ status: 'resent' as const, email: 'x@example.com' }),
    },
  });
  await h.api.seedTenantRoles(TENANT);
  enrolMember(h.state, TENANT, 'owner-1', 'DIRECTOR');
  enrolMember(h.state, TENANT, 'clerk-2', 'CLERK');
  return { h, invited };
}

describe('the Equipe API asks permissions, not a tier (FUT-3661)', () => {
  it('a MANAGER-like holder of team:read opens the roster read-only', async () => {
    // Deliberate difference: under the admin tier this member got 403 on the
    // reads as well.
    const { h, invited } = await host();
    enrolMember(h.state, TENANT, 'lead-1', 'BRANCH_LEAD');
    const actor = memberActor(TENANT, 'lead-1');

    for (const read of READS) {
      expect((await call(h, read, actor)).status, `${read[0]} ${read[1]}`).toBe(200);
    }
    for (const write of WRITES) {
      const response = await call(h, write, actor);
      expect(response.status, `${write[0]} ${write[1]}`).toBe(403);
      expect((response.body as { error: string }).error).toBe(PT_BR_RBAC_MESSAGES.forbidden);
    }
    // No refused write reached the port or the membership rows.
    expect(invited).toEqual([]);
    expect(h.state.memberships.find((m) => m.userId === 'clerk-2')?.active).toBe(true);
  });

  it('a custom role holding team:manage invites with no admin tier', async () => {
    // Deliberate difference: a CLERK's base role is outside every former admin
    // tier, and the custom role is what admits them.
    const { h, invited } = await host();
    seedRole(h.state, { clientId: TENANT, name: 'Recrutamento', permissions: ['team:manage'] });
    enrolMember(h.state, TENANT, 'clerk-1', 'CLERK');
    linkRole(h.state, 'clerk-1', 'Recrutamento');

    const response = await call(
      h,
      ['POST', '/team', { body: { email: 'novo@example.com' } }],
      memberActor(TENANT, 'clerk-1'),
    );
    expect(response.status).toBe(200);
    expect(invited).toEqual(['novo@example.com']);
  });

  it('the same CLERK without the custom role is refused every write', async () => {
    const { h, invited } = await host();
    enrolMember(h.state, TENANT, 'clerk-1', 'CLERK');
    const actor = memberActor(TENANT, 'clerk-1');
    for (const request of [...READS, ...WRITES]) {
      expect((await call(h, request, actor)).status, `${request[0]} ${request[1]}`).toBe(403);
    }
    expect(invited).toEqual([]);
  });

  it('a member whose base role names a former admin tier is refused without the permission', async () => {
    // The tier no longer admits on its own: a HEAD_LIBRARIAN membership row
    // with no role LINK resolves no permissions, so every gate refuses.
    const { h } = await host();
    h.state.memberships.push({
      id: 'm-bare',
      userId: 'bare-1',
      clientId: TENANT,
      role: 'HEAD_LIBRARIAN',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const actor = memberActor(TENANT, 'bare-1');
    for (const request of [...READS, ...WRITES]) {
      expect((await call(h, request, actor)).status, `${request[0]} ${request[1]}`).toBe(403);
    }
  });

  it('an ADMIN-like + WAITER-like member is unchanged: every read and write admitted', async () => {
    const { h, invited } = await host();
    enrolMember(h.state, TENANT, 'admin-1', 'HEAD_LIBRARIAN');
    linkRole(h.state, 'admin-1', 'CLERK');
    const actor = memberActor(TENANT, 'admin-1');
    for (const request of [...READS, ...WRITES]) {
      expect((await call(h, request, actor)).status, `${request[0]} ${request[1]}`).toBe(200);
    }
    expect(invited).toEqual(['novo@example.com']);
    // The last write removed the CLERK it aimed at.
    expect(h.state.memberships.some((m) => m.userId === 'clerk-2')).toBe(false);
  });

  it('the owner rules still read the caller tier: a team:manage holder cannot remove an owner', async () => {
    const { h } = await host();
    seedRole(h.state, { clientId: TENANT, name: 'Recrutamento', permissions: ['team:manage'] });
    enrolMember(h.state, TENANT, 'clerk-1', 'CLERK');
    linkRole(h.state, 'clerk-1', 'Recrutamento');
    const response = await call(
      h,
      ['DELETE', '/team/:userId', { params: { userId: 'owner-1' } }],
      memberActor(TENANT, 'clerk-1'),
    );
    expect(response.status).toBe(403);
    expect((response.body as { error: string }).error).toBe(
      PT_BR_RBAC_MESSAGES.onlyOwnerRemovesOwner,
    );
    expect(h.state.memberships.some((m) => m.userId === 'owner-1')).toBe(true);
  });
});

describe('GET /permissions admits a caller who holds any permission here (FUT-3661)', () => {
  it('a member whose roles grant nothing is refused, whatever their tier', async () => {
    const { h } = await host();
    seedRole(h.state, { clientId: TENANT, name: 'Vazio', permissions: [] });
    enrolMember(h.state, TENANT, 'empty-1', 'Vazio');
    const response = await call(h, ['GET', '/permissions'], memberActor(TENANT, 'empty-1'));
    expect(response.status).toBe(403);
  });

  it('a customer-tier member granted a role holding a permission enters', async () => {
    // Deliberate difference: the shell's gate used to refuse the customer TIER
    // whatever the member's roles granted.
    const { h } = await host();
    seedRole(h.state, { clientId: TENANT, name: 'Leitor', permissions: ['titles:read:all'] });
    enrolMember(h.state, TENANT, 'patron-1', 'PATRON');
    linkRole(h.state, 'patron-1', 'Leitor');
    const response = await call(h, ['GET', '/permissions'], memberActor(TENANT, 'patron-1'));
    expect(response.status).toBe(200);
    expect((response.body as { data: { permissions: string[] } }).data.permissions).toEqual([
      'titles:read:all',
    ]);
  });
});
