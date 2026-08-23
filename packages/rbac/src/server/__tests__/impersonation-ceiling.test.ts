import { describe, expect, it, vi } from 'vitest';

import {
  createImpersonationCeiling,
  outsideBoundedTenant,
  type CeilingImpersonation,
} from '../impersonation-ceiling';
import { createFakeRbacDb } from './fake-db';
import type { RbacDbProvider } from '../db';

/**
 * The ceiling, as the security property it is.
 *
 * `./guards` already intersects with a ceiling and forces `isSuper` off when
 * one is present. These cases cover the half that decides WHAT the ceiling is,
 * and every one of them is a way the feature inverts if it is wrong: a ceiling
 * that is `null` when it should be a set hands the actor the target's rights on
 * top of their own, and one that is a set when it should be `null` silently
 * strips a support operator mid-ticket.
 */

const TENANT = 'client-1';
const ACTOR = 'user-real';

function ceilingOver(over: Partial<Parameters<typeof createImpersonationCeiling>[0]> = {}) {
  const { db, state } = createFakeRbacDb();
  const actorPermissions = vi.fn(async () => new Set(['orders:read', 'orders:write']));
  const resolve = createImpersonationCeiling({
    db: (() => Promise.resolve(db)) as unknown as RbacDbProvider,
    catalogPermissions: () => ['orders:read', 'orders:write', 'roles:manage'],
    actorPermissions,
    isUnboundedScope: (scope) => scope === 'GLOBAL' || scope.startsWith('org:'),
    ...over,
  });
  return { resolve, state, actorPermissions };
}

const preview = (over: Partial<CeilingImpersonation> = {}): CeilingImpersonation => ({
  kind: 'preview',
  tenantId: TENANT,
  realUserId: ACTOR,
  previewRoleName: null,
  ...over,
});

describe('outsideBoundedTenant', () => {
  const unbounded = (scope: string) => scope === 'GLOBAL' || scope.startsWith('org:');

  it('refuses a scope that is a DIFFERENT tenant', () => {
    expect(outsideBoundedTenant({ tenantId: TENANT }, 'client-2', unbounded)).toBe(true);
  });

  it('allows the session own tenant', () => {
    expect(outsideBoundedTenant({ tenantId: TENANT }, TENANT, unbounded)).toBe(false);
  });

  it('exempts the scopes the host says are not tenants', () => {
    // The app shell's own reads. Refusing them breaks the shell around an
    // otherwise valid session.
    expect(outsideBoundedTenant({ tenantId: TENANT }, 'GLOBAL', unbounded)).toBe(false);
    expect(outsideBoundedTenant({ tenantId: TENANT }, 'org:acme', unbounded)).toBe(false);
  });
});

describe('createImpersonationCeiling', () => {
  it('does not narrow when there is no impersonation', async () => {
    const { resolve } = ceilingOver();
    await expect(resolve(null, TENANT)).resolves.toBeNull();
  });

  it('does not narrow an OPERATOR session — be exactly the target', async () => {
    // Neither more nor less: the guards force platform authority off, so `null`
    // here means "the target's own rights", not "unbounded".
    const { resolve } = ceilingOver();
    await expect(resolve(preview({ kind: 'operator' }), TENANT)).resolves.toBeNull();
  });

  it('denies EVERYTHING in a tenant the session was not started for', async () => {
    // The empty set, not `null`. `null` would mean "nothing narrows" and hand
    // the caller their full rights in a store nobody consented to or audited.
    const { resolve } = ceilingOver();
    const ceiling = await resolve(preview(), 'client-2');
    expect(ceiling).not.toBeNull();
    expect(ceiling?.size).toBe(0);
  });

  it('denies everything in a second tenant even for an OPERATOR', async () => {
    // The bound is checked BEFORE the kind, so the unbounded kind is bounded
    // too — a second store is a second start.
    const { resolve } = ceilingOver();
    expect((await resolve(preview({ kind: 'operator' }), 'client-2'))?.size).toBe(0);
  });

  it('ceils a MEMBER preview at the ACTOR own set', async () => {
    const { resolve, actorPermissions } = ceilingOver();
    const ceiling = await resolve(preview(), TENANT);
    expect([...(ceiling ?? [])].sort()).toEqual(['orders:read', 'orders:write']);
    // Asked about the REAL human, never the previewed subject — the ceiling is
    // what the actor genuinely holds.
    expect(actorPermissions).toHaveBeenCalledWith(ACTOR, TENANT);
  });

  it('warms the scope before reading the actor set', async () => {
    // Org-scope grants vanish from a cold cache, and a ceiling missing them
    // REVOKES rights the actor really holds.
    const order: string[] = [];
    const { resolve } = ceilingOver({
      warmScope: async () => {
        order.push('warm');
      },
      actorPermissions: async () => {
        order.push('read');
        return new Set(['orders:read']);
      },
    });
    await resolve(preview(), TENANT);
    expect(order).toEqual(['warm', 'read']);
  });

  it('ceils a ROLE preview at that role own row', async () => {
    const { resolve, state } = ceilingOver();
    state.roles.push({
      id: 'r1',
      clientId: TENANT,
      name: 'WAITER',
      permissions: JSON.stringify(['orders:read']),
      description: null,
      kind: 'custom',
      locked: false,
      isTemplate: false,
      archivedAt: null,
      createdAt: new Date(0),
    });
    const ceiling = await resolve(preview({ previewRoleName: 'WAITER' }), TENANT);
    expect([...(ceiling ?? [])]).toEqual(['orders:read']);
  });

  it('previews a WILDCARD role as the whole catalog — which then intersects down', async () => {
    const { resolve, state } = ceilingOver();
    state.roles.push({
      id: 'r2',
      clientId: TENANT,
      name: 'OWNER',
      permissions: '*',
      description: null,
      kind: 'template',
      locked: true,
      isTemplate: true,
      archivedAt: null,
      createdAt: new Date(0),
    });
    const ceiling = await resolve(preview({ previewRoleName: 'OWNER' }), TENANT);
    // The guards intersect this with the actor's real set, so "preview the
    // owner" resolves to exactly the actor's own rights — never more.
    expect([...(ceiling ?? [])].sort()).toEqual(['orders:read', 'orders:write', 'roles:manage']);
  });

  it('grants NOTHING for a role name the tenant does not have', async () => {
    // Deny-by-default and visibly wrong to the operator, rather than a silent
    // fallback that grants more than the row says.
    const { resolve } = ceilingOver();
    const ceiling = await resolve(preview({ previewRoleName: 'NO_SUCH_ROLE' }), TENANT);
    expect(ceiling?.size).toBe(0);
  });

  it('never asks the engine for a ROLE preview', async () => {
    // The role's row is the authority; asking the engine would resolve the
    // ACTOR's set and ceil at the wrong thing entirely.
    const { resolve, state, actorPermissions } = ceilingOver();
    state.roles.push({
      id: 'r3',
      clientId: TENANT,
      name: 'COOK',
      permissions: JSON.stringify(['kitchen:read']),
      description: null,
      kind: 'custom',
      locked: false,
      isTemplate: false,
      archivedAt: null,
      createdAt: new Date(0),
    });
    await resolve(preview({ previewRoleName: 'COOK' }), TENANT);
    expect(actorPermissions).not.toHaveBeenCalled();
  });
});
