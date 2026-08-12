import { describe, expect, it } from 'vitest';

import {
  getActorAttribution,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
} from './actor-context';

/**
 * The impersonation half of the per-request actor context (FUT-458).
 *
 * The audit writer's own unit suite mocks this module away, so nothing there
 * exercises the plumbing that actually carries `onBehalfOfUserId` from a guard
 * to the row: {@link setActor}'s merge rule and what {@link getActorAttribution}
 * hands back. Both are easy to get subtly wrong in a way no consumer notices
 * until an audit trail is already missing entries, which is exactly the kind of
 * bug that cannot be fixed after the fact on an append-only table.
 *
 * Every case runs inside {@link runWithActorScope}, which is how the real
 * request pipeline enters this context (`createRouteHandler`) — and the only
 * mode where the merge branch under test is reached at all.
 */
describe('actor context — impersonation attribution (FUT-458)', () => {
  const REAL = 'support-agent';
  const TARGET = 'shop-owner';

  it('carries the impersonated identity alongside the real actor', () => {
    runWithActorScope(() => {
      setActor(REAL, {
        role: 'OWNER',
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
      });

      expect(getActorUserId()).toBe(REAL);
      expect(getActorAttribution()).toEqual({
        role: 'OWNER',
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
        // Derived from the same stamp, never passed by the caller.
        realUserId: REAL,
      });
    });
  });

  it('keeps naming the real human after an unaware stamp re-points the actor', () => {
    // THE regression this pair exists for. About sixty route bodies (plus
    // `apps/web/lib/api/tenant.ts`) call `setActor(grant.userId, …)`
    // themselves, and while a session is impersonated the tenant guard
    // resolves that grant for the EFFECTIVE subject — so the id doing the
    // clobbering is the target's own. `userId` moves, as it must; the pair
    // must not, or the audit row names the impersonated person as the actor on
    // an append-only table.
    runWithActorScope(() => {
      setActor(REAL, { role: 'SUPERADMIN', scope: 'tenant-1', onBehalfOfUserId: TARGET });
      setActor(TARGET, { role: 'OWNER', scope: 'tenant-1' });

      expect(getActorUserId()).toBe(TARGET);
      expect(getActorAttribution()).toEqual({
        role: 'OWNER',
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
        realUserId: REAL,
      });
    });
  });

  it('leaves the impersonation untouched when a later stamp omits it', () => {
    // A guard deeper in the request that only knows the scope must not erase
    // an impersonation an earlier guard established — the same reason role and
    // scope merge rather than replace.
    runWithActorScope(() => {
      setActor(REAL, { onBehalfOfUserId: TARGET });
      setActor(REAL, { scope: 'tenant-1' });

      expect(getActorAttribution()).toEqual({
        role: undefined,
        scope: 'tenant-1',
        onBehalfOfUserId: TARGET,
        realUserId: REAL,
      });
    });
  });

  it('clears the impersonation only on an explicit null, and clears BOTH halves', () => {
    // Ending a session has to be expressible. `undefined` means "no opinion"
    // under the merge rule, so a clear that used it would leak the target onto
    // every write for the rest of the request. The real id goes with it: left
    // behind, it would make an ordinary later write look as though it still
    // carried a hidden second identity.
    runWithActorScope(() => {
      setActor(REAL, { onBehalfOfUserId: TARGET });
      setActor(REAL, { onBehalfOfUserId: null });

      expect(getActorAttribution()).toEqual({
        role: undefined,
        scope: undefined,
        onBehalfOfUserId: null,
        realUserId: null,
      });
    });
  });

  it('reports no impersonation for an ordinary stamped request', () => {
    runWithActorScope(() => {
      setActor('user-7', { role: 'ADMIN', scope: 'tenant-1' });

      expect(getActorAttribution().onBehalfOfUserId).toBeUndefined();
      expect(getActorAttribution().realUserId).toBeUndefined();
    });
  });

  it('derives the pair for a fresh scope too, not just the merge path', () => {
    // `runWithActor` builds a whole new context rather than mutating one, and
    // background work (jobs, scripts) enters the context that way. The
    // derivation has to live in both constructors or the guarantee holds only
    // for requests.
    runWithActor(REAL, () => {
      expect(getActorAttribution().realUserId).toBe(REAL);
      expect(getActorAttribution().onBehalfOfUserId).toBe(TARGET);
    }, { onBehalfOfUserId: TARGET });
  });
});
