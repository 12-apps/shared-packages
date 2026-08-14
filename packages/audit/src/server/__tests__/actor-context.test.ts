/* eslint-disable test-flakiness/no-unconditional-wait --
   the `setTimeout(resolve, 0)` in the concurrency case is the INTERLEAVING under
   test: the requests must yield between their stamp and their read, or nothing is
   proven about isolation. There is no condition to wait for — the point is that
   the scheduler runs the other request in the gap. */
import { describe, expect, it } from 'vitest';

import { AuditConfigError } from '../../core/errors';
import type { ActorAttribution } from '../actor-context';
import {
  actorContextKey,
  DEFAULT_ACTOR_STORE_KEY,
  getActorAttribution,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
  useActorContextKey,
} from '../actor-context';

/**
 * The per-request actor context, plus the two properties an adversarial reader
 * asks for first: that concurrent
 * requests cannot see each other's actor, and that the impersonation pair cannot
 * be forged from outside.
 *
 * Every case runs inside {@link runWithActorScope}, which is how a request enters
 * this context — and the only mode where {@link setActor}'s merge branch is
 * reached at all.
 */
const REAL = 'support-agent';
const TARGET = 'shop-owner';

describe('impersonation attribution', () => {
  it('carries the impersonated identity alongside the real actor', () => {
    runWithActorScope(() => {
      setActor(REAL, { role: 'OWNER', scope: 'tenant-1', onBehalfOfUserId: TARGET });

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
    // THE regression this pair exists for. Route bodies call
    // `setActor(grant.userId, …)` themselves, and while a session is impersonated
    // the tenant guard resolves that grant for the EFFECTIVE subject — so the id
    // doing the clobbering is the target's own. `userId` moves, as it must; the
    // pair must not, or the audit row names the impersonated person as the actor
    // on an append-only table.
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
    // background work (jobs, scripts) enters the context that way. The derivation
    // has to live in both constructors or the guarantee holds only for requests.
    runWithActor(
      REAL,
      () => {
        expect(getActorAttribution().realUserId).toBe(REAL);
        expect(getActorAttribution().onBehalfOfUserId).toBe(TARGET);
      },
      { onBehalfOfUserId: TARGET },
    );
  });

  it('IGNORES a realUserId a caller tries to pass', () => {
    // The pair's whole value is that only the stamp that knows both halves can
    // write it. Attribution objects come from host code, so this is the shape a
    // spoof would take: name someone else as answerable while the actor stays
    // yourself. Both constructors build their context field by field, so the key
    // never lands — with an impersonation declared or without one.
    const forged = { onBehalfOfUserId: TARGET, realUserId: 'someone-else' };
    runWithActorScope(() => {
      setActor(REAL, forged);
      expect(getActorAttribution().realUserId).toBe(REAL);
    });
    runWithActor(REAL, () => {
      expect(getActorAttribution().realUserId).toBe(REAL);
    }, forged);
    // …and with no impersonation declared at all, where the derivation does not
    // run, the key must still not survive into the snapshot.
    runWithActorScope(() => {
      setActor(REAL, { realUserId: 'someone-else' } as unknown as ActorAttribution);
      expect(getActorAttribution().realUserId).toBeUndefined();
    });
  });

  it('ignores a falsy actor id rather than stamping an empty string', () => {
    runWithActorScope(() => {
      setActor('');
      expect(getActorUserId()).toBeUndefined();
    });
  });
});

describe('scope isolation', () => {
  it('survives a stamp made inside an AWAITED guard', async () => {
    // The reason `runWithActorScope` exists at all: `setActor` inside an awaited
    // guard would otherwise reach only the guard's own continuation, so the stamp
    // vanishes before the handler resumes and every entry reads "system".
    await runWithActorScope(async () => {
      const guard = async (): Promise<void> => {
        await Promise.resolve();
        setActor('user-9', { role: 'ADMIN' });
      };
      await guard();
      expect(getActorUserId()).toBe('user-9');
      expect(getActorAttribution().role).toBe('ADMIN');
    });
  });

  it('never leaks an actor between INTERLEAVED concurrent requests', async () => {
    // The hazard an AsyncLocalStorage-backed context is always suspected of, and
    // the one a sequential suite cannot see. Two requests are started together and
    // deliberately interleave: each yields between its stamp and its read, and one
    // of them re-stamps in between (the route-body pattern). If the store were
    // shared — a module-level variable, `enterWith` at the request boundary — the
    // second stamp would be visible to the first request.
    const observed: string[] = [];
    const request = async (userId: string, subject: string | null): Promise<string> =>
      runWithActorScope(async () => {
        setActor(userId, { role: `role-${userId}`, onBehalfOfUserId: subject });
        await new Promise((resolve) => setTimeout(resolve, 0));
        // A deeper guard re-stamps the SAME request's actor mid-flight.
        setActor(userId, { scope: `scope-${userId}` });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const attribution = getActorAttribution();
        observed.push(`${getActorUserId()}|${attribution.role}|${attribution.scope}`);
        return `${getActorUserId()}|${attribution.onBehalfOfUserId}|${attribution.realUserId}`;
      });

    const [first, second, third] = await Promise.all([
      request('user-a', 'target-a'),
      request('user-b', null),
      request('user-c', 'target-c'),
    ]);

    expect(first).toBe('user-a|target-a|user-a');
    expect(second).toBe('user-b|null|null');
    expect(third).toBe('user-c|target-c|user-c');
    expect(observed.sort()).toEqual([
      'user-a|role-user-a|scope-user-a',
      'user-b|role-user-b|scope-user-b',
      'user-c|role-user-c|scope-user-c',
    ]);
  });

  it('keeps its store under the key it was told to, and no other', () => {
    // WHERE the store lives is a cross-package contract, and it is CONFIG: a
    // host with an in-house actor-context module and dozens of `setActor(...)`
    // call sites importing it needs both modules on ONE store, and declares
    // that with `useActorContextKey`. A key this package chose for that host
    // would be the same host vocabulary compiled in that the rest of this
    // release removes.
    //
    // The failure it prevents is silent: a forked store means the writer reads
    // one nothing ever stamped, so every entry lands with no actor at all, the
    // viewer renders the system label for every human action, and the table is
    // append-only.
    const globals = globalThis as unknown as Record<
      string,
      { getStore(): { userId: string } | undefined } | undefined
    >;

    expect(actorContextKey()).toBe(DEFAULT_ACTOR_STORE_KEY);

    runWithActorScope(() => {
      setActor('user-7', { role: 'ADMIN' });
      expect(globals[DEFAULT_ACTOR_STORE_KEY]?.getStore()).toEqual({
        userId: 'user-7',
        role: 'ADMIN',
      });
    });
  });

  it('refuses to move the key once the store exists', () => {
    // Re-declaring the key in force is a no-op, so a module that declares it
    // defensively at import time is safe to load twice. Moving it to a
    // DIFFERENT key after the store was created is refused: contexts already
    // captured against the old instance keep flowing to it while every later
    // read goes elsewhere — the same silent fork, made intermittent.
    expect(() => useActorContextKey(DEFAULT_ACTOR_STORE_KEY)).not.toThrow();
    expect(() => useActorContextKey('__someHostActorStore')).toThrow(AuditConfigError);
    expect(() => useActorContextKey('')).toThrow(AuditConfigError);
    // …and the store did not move.
    expect(actorContextKey()).toBe(DEFAULT_ACTOR_STORE_KEY);
  });

  it('reports no actor outside any scope', () => {
    // Every read is `?.`-guarded, so code that runs before a request boundary
    // (module init, a script) sees a system context rather than throwing.
    expect(getActorUserId()).toBeUndefined();
    expect(getActorAttribution()).toEqual({
      role: undefined,
      scope: undefined,
      onBehalfOfUserId: undefined,
      realUserId: undefined,
    });
  });
});
