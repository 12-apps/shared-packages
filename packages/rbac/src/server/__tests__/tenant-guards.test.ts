import { describe, expect, it, vi } from 'vitest';

import {
  createTenantGuards,
  type TenantGuardActor,
  type TenantGuardsConfig,
} from '../tenant-guards';
import type { CeilingImpersonation } from '../impersonation-ceiling';

/**
 * The tenant-role axis.
 *
 * The ORDER of the four steps is the whole security property, so each step gets
 * a case that fails if it moves. The escalation this replaces was not a wrong
 * check — it was a check in one of two resolvers, where the second went on
 * answering from the real session's platform allowlist.
 */

type Role = 'OWNER' | 'ADMIN' | 'WAITER';
const TENANT = 'client-1';

const actor = (over: Partial<TenantGuardActor> = {}): TenantGuardActor => ({
  email: 'a@b.c',
  userId: 'u1',
  isSuper: false,
  realUserId: 'u1',
  impersonation: null,
  ...over,
});

const impersonation = (over: Partial<CeilingImpersonation> = {}): CeilingImpersonation => ({
  kind: 'preview',
  tenantId: TENANT,
  realUserId: 'real',
  previewRoleName: null,
  ...over,
});

function guardsOver(over: Partial<TenantGuardsConfig<Role>> = {}) {
  const config: TenantGuardsConfig<Role> = {
    resolveActor: async () => actor(),
    resolveTier: async () => 'ADMIN',
    isUnboundedScope: (scope) => scope === 'GLOBAL' || scope.startsWith('org:'),
    defaultRoles: ['OWNER', 'ADMIN'],
    ...over,
  };
  return createTenantGuards(config);
}

describe('createTenantGuards', () => {
  it('refuses an anonymous caller as UNAUTHENTICATED, not forbidden', async () => {
    // A signed-out caller has to be told to sign in, not that they lack a
    // permission they might well have once they do.
    const guards = guardsOver({ resolveActor: async () => actor({ email: null }) });
    expect(await guards.requireTenantRole(TENANT)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
  });

  it('refuses a session reaching into a DIFFERENT tenant, before anything can grant', async () => {
    // Step 2 runs before the platform short-circuit, so even an operator is
    // bound: a second store is a second, separately audited start.
    const guards = guardsOver({
      resolveActor: async () => actor({ isSuper: true, impersonation: impersonation() }),
    });
    expect(await guards.requireTenantRole('client-2')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('never consults the tier resolver for a bounded-out session', async () => {
    const resolveTier = vi.fn(async () => 'OWNER' as Role);
    const guards = guardsOver({
      resolveActor: async () => actor({ impersonation: impersonation() }),
      resolveTier,
    });
    await guards.requireTenantRole('client-2');
    expect(resolveTier).not.toHaveBeenCalled();
  });

  it('short-circuits a platform actor to every tenant', async () => {
    const guards = guardsOver({
      resolveActor: async () => actor({ isSuper: true, userId: null, realUserId: 'p1' }),
    });
    const outcome = await guards.requireTenantRole(TENANT);
    expect(outcome).toMatchObject({ ok: true, grant: { role: 'PLATFORM', realUserId: 'p1' } });
  });

  it('carries an empty userId for a platform actor with no row of their own', async () => {
    // Never used for a write, and deliberately not `null`, which the grant's
    // own field would confuse with "there is no real human".
    const guards = guardsOver({
      resolveActor: async () => actor({ isSuper: true, userId: null, realUserId: null }),
    });
    const outcome = await guards.requireTenantRole(TENANT);
    expect(outcome).toMatchObject({ ok: true, grant: { userId: '', realUserId: null } });
  });

  it('does NOT reach the platform branch while impersonating', async () => {
    // THE escalation fix, stated as a test: a caller resolving an impersonated
    // actor forces `isSuper` false, so the target's own tier decides. If the
    // branch were reachable, this would answer PLATFORM instead of WAITER.
    const guards = guardsOver({
      resolveActor: async () =>
        actor({ isSuper: false, impersonation: impersonation(), userId: 'target' }),
      resolveTier: async () => 'WAITER',
      defaultRoles: ['OWNER', 'ADMIN', 'WAITER'],
    });
    const outcome = await guards.requireTenantRole(TENANT);
    expect(outcome).toMatchObject({ ok: true, grant: { role: 'WAITER', userId: 'target' } });
  });

  it('refuses a signed-in caller with no user row as UNAUTHENTICATED', async () => {
    // There is no identity to key a membership to. A 403 would tell a
    // half-provisioned account it lacks permission it might well have.
    const guards = guardsOver({ resolveActor: async () => actor({ userId: null }) });
    expect(await guards.requireTenantRole(TENANT)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
  });

  it('asks the tier resolver about the EFFECTIVE subject', async () => {
    const resolveTier = vi.fn(async () => 'ADMIN' as Role);
    const imp = impersonation();
    const guards = guardsOver({
      resolveActor: async () => actor({ userId: 'target', impersonation: imp }),
      resolveTier,
    });
    await guards.requireTenantRole(TENANT);
    // The impersonated user, not the real human — and the impersonation is
    // handed along so the resolver can narrow a preview.
    expect(resolveTier).toHaveBeenCalledWith('target', TENANT, imp);
  });

  it('refuses a tier outside the requested roles', async () => {
    const guards = guardsOver({ resolveTier: async () => 'WAITER' });
    expect(await guards.requireTenantRole(TENANT, ['OWNER'])).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('refuses when the subject holds no tier at all', async () => {
    const guards = guardsOver({ resolveTier: async () => null });
    expect(await guards.requireTenantRole(TENANT)).toMatchObject({ ok: false });
  });

  it('canAdminTenant collapses both refusals to false, sharing one body', async () => {
    // It MUST stay non-throwing: a public route can call it inside a
    // Promise.all, where a throw would 500 the page for anonymous visitors.
    const anon = guardsOver({ resolveActor: async () => actor({ email: null }) });
    const wrongTier = guardsOver({ resolveTier: async () => 'WAITER' });
    await expect(anon.canAdminTenant(TENANT)).resolves.toBe(false);
    await expect(wrongTier.canAdminTenant(TENANT)).resolves.toBe(false);
    await expect(guardsOver().canAdminTenant(TENANT)).resolves.toBe(true);
  });

  it('exempts a non-tenant scope from the bound', async () => {
    // The app shell's own reads resolve against the subject's grants like
    // everything else; refusing them breaks the shell around a valid session.
    const guards = guardsOver({
      resolveActor: async () => actor({ impersonation: impersonation() }),
    });
    await expect(guards.canAdminTenant('GLOBAL')).resolves.toBe(true);
  });
});
