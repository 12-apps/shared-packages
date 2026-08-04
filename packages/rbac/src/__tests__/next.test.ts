import { describe, it, expect, vi } from 'vitest';
import { createRbacGuards } from '../next/guards';
import { PermissionDeniedError } from '../core/errors';
import type { Rbac, CheckContext } from '../core/engine';
import type { AuthzAdapter } from '../core/types';

const scopeOf = (context?: CheckContext) => context?.scope ?? 'GLOBAL';

/** Minimal stub engine: grants only 'ok' in scope 'S'. */
function stubRbac(): Rbac<string> {
  const granted = (permission: string, scope: string) =>
    permission === 'ok' && scope === 'S';
  const adapter: AuthzAdapter = {
    check: async (_s, action, _r, ctx) =>
      granted(action, scopeOf(ctx as CheckContext)),
    visible: async () => ({ kind: 'none' }),
  };
  return {
    adapter,
    can: async (_subject, action, _resource, context) =>
      granted(action, scopeOf(context)),
    visibleResources: async () => ({ kind: 'none' }),
    getPermissions: async () => new Set<string>(),
    requirePermission: async (subject, action, _resource, context) => {
      if (!granted(action, scopeOf(context))) {
        throw new PermissionDeniedError(subject, action, scopeOf(context));
      }
    },
    canWithAssignments: (_a, permission, scope) => granted(permission, scope),
  };
}

describe('createRbacGuards.requirePermission', () => {
  it('throws when the actor is null', async () => {
    const guards = createRbacGuards(stubRbac(), async () => null);
    await expect(guards.requirePermission('ok', 'S')).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(guards.requirePermission('ok', 'S')).rejects.toMatchObject({
      actorId: 'anonymous',
      permission: 'ok',
      scope: 'S',
    });
  });

  it('throws when denied for a real actor', async () => {
    const guards = createRbacGuards(stubRbac(), async () => 'u1');
    await expect(
      guards.requirePermission('nope', 'S'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('passes (resolves) when granted', async () => {
    const getActorId = vi.fn(async () => 'u1');
    const guards = createRbacGuards(stubRbac(), getActorId);
    await expect(guards.requirePermission('ok', 'S')).resolves.toBeUndefined();
    expect(getActorId).toHaveBeenCalled();
  });
});

describe('createRbacGuards.can', () => {
  it('returns false for a null actor', async () => {
    const guards = createRbacGuards(stubRbac(), async () => null);
    await expect(guards.can('ok', 'S')).resolves.toBe(false);
  });

  it('delegates to the engine for a real actor', async () => {
    const guards = createRbacGuards(stubRbac(), async () => 'u1');
    await expect(guards.can('ok', 'S')).resolves.toBe(true);
    await expect(guards.can('ok', 'OTHER')).resolves.toBe(false);
  });
});
