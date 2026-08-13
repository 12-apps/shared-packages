/* eslint-disable test-flakiness/no-unconditional-wait --
   the `setTimeout(resolve, 0)` is the INTERLEAVING under test: two requests must
   yield between their stamp and their read, or the concurrency case proves
   nothing. There is no condition to wait for — the point is that the scheduler
   runs the other request in the gap. */
import { describe, expect, it } from 'vitest';

import { FUTURE_PAY_AUDIT_VOCABULARY } from '../../index';
import { getActorAttribution, getActorUserId } from '../actor-context';
import type { AuditActor, AuditRequest } from '../config';
import { createApiAudit } from '../create-api-audit';

import { fakeAuditDb } from './fake-db';

/**
 * The actor-context middleware (12-14) — what a host mounts around every request
 * so writes are attributed without threading an actor through call sites.
 *
 * Two properties matter, and both are the ones an adversarial reader goes for
 * first: the actor comes from `resolveActor` and NEVER from request input, and
 * concurrent requests cannot see each other's.
 */
function surface(resolveActor: (request: AuditRequest) => AuditActor | null) {
  const fake = fakeAuditDb();
  return createApiAudit({
    db: () => Promise.resolve(fake.db),
    resolveActor,
    vocabulary: FUTURE_PAY_AUDIT_VOCABULARY,
  });
}

const request = (headers: Record<string, string> = {}): AuditRequest => ({
  params: {},
  query: {},
  header: (name) => headers[name],
});

describe('withActorContext', () => {
  it('stamps the actor the host resolved, pair included', async () => {
    const api = surface(() => ({
      tenantId: 't1',
      userId: 'u-real',
      permissions: ['audit:read'],
      role: 'SUPERADMIN',
      scope: 't1',
      onBehalfOfUserId: 'u-target',
    }));

    const seen = await api.withActorContext(request(), async () => ({
      userId: getActorUserId(),
      attribution: getActorAttribution(),
    }));

    expect(seen.userId).toBe('u-real');
    expect(seen.attribution).toEqual({
      role: 'SUPERADMIN',
      scope: 't1',
      onBehalfOfUserId: 'u-target',
      realUserId: 'u-real',
    });
  });

  it('opens an EMPTY scope for an unauthenticated request', async () => {
    // The scope still has to exist: a guard deeper in the request stamps into it,
    // and without a boundary that stamp would not survive the caller's await.
    const api = surface(() => null);

    const seen = await api.withActorContext(request(), async () => getActorUserId());

    expect(seen).toBeUndefined();
  });

  it('stamps nothing for a caller with no user row', async () => {
    // A platform operator authorized by an allowlist. Inventing an actor id would
    // put a name on a row that has no person behind it.
    const api = surface(() => ({
      tenantId: 't1',
      userId: null,
      permissions: ['*'],
      isSuper: true,
    }));

    const seen = await api.withActorContext(request(), async () => getActorUserId());

    expect(seen).toBeUndefined();
  });

  it('takes the actor from resolveActor, never from a header the caller sent', async () => {
    // The spoof: a request naming its own actor. `resolveActor` is host code and
    // may read a header deliberately — the point is that the PACKAGE does not, so a
    // host reading a session cookie is not silently overridden by request input.
    const api = surface(() => ({ tenantId: 't1', userId: 'u-real', permissions: [] }));

    const seen = await api.withActorContext(
      request({ 'x-actor-user': 'u-attacker', 'x-on-behalf-of': 'u-victim' }),
      async () => ({ userId: getActorUserId(), attribution: getActorAttribution() }),
    );

    expect(seen.userId).toBe('u-real');
    expect(seen.attribution.onBehalfOfUserId).toBeUndefined();
  });

  it('cannot leak an actor between concurrent requests', async () => {
    // Interleaved deliberately: each request yields between its stamp and its read.
    // A shared store — a module variable, or `enterWith` at the boundary — would let
    // the later stamp be observed by the earlier request.
    const api = surface((req) => ({
      tenantId: 't1',
      userId: req.header('x-user') ?? 'anon',
      permissions: [],
      onBehalfOfUserId: req.header('x-subject') ?? null,
    }));

    const observe = (user: string, subject?: string): Promise<string> =>
      api.withActorContext(
        request({ 'x-user': user, ...(subject ? { 'x-subject': subject } : {}) }),
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const attribution = getActorAttribution();
          return `${getActorUserId()}|${attribution.onBehalfOfUserId}|${attribution.realUserId}`;
        },
      );

    expect(await Promise.all([observe('u-a', 's-a'), observe('u-b'), observe('u-c', 's-c')])).toEqual(
      ['u-a|s-a|u-a', 'u-b|null|null', 'u-c|s-c|u-c'],
    );
  });

  it('does not leak the actor OUT of the request that stamped it', async () => {
    const api = surface(() => ({ tenantId: 't1', userId: 'u-real', permissions: [] }));

    await api.withActorContext(request(), async () => getActorUserId());

    expect(getActorUserId()).toBeUndefined();
  });
});

describe('extendPrismaClient', () => {
  it('applies BOTH extensions, with the host tracked-model set', () => {
    // The composed helper is what a host calls once at client construction; the
    // extensions' own behaviour is pinned in extensions.test.ts.
    const applied: string[] = [];
    const client = {
      $extends(extension: unknown) {
        applied.push((extension as { name: string }).name);
        return this;
      },
    };
    const fake = fakeAuditDb();
    const api = createApiAudit({
      db: () => Promise.resolve(fake.db),
      resolveActor: () => null,
      vocabulary: FUTURE_PAY_AUDIT_VOCABULARY,
      trackedModels: ['MenuItem'],
    });

    api.extendPrismaClient(client);

    expect(applied).toEqual(['auditStamps', 'appendOnlyGuard']);
  });
});
