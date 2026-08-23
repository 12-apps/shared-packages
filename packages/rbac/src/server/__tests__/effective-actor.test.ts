import { describe, expect, it, vi } from 'vitest';

import {
  attributionOf,
  createEffectiveActor,
  type ActorImpersonation,
  type EffectiveActorConfig,
} from '../effective-actor';

/**
 * The one resolver both authority axes sit on.
 *
 * The rule these cases exist for is `isSuper: false`. Every guard
 * short-circuits on it before asking anything else, so leaving it true while
 * impersonating hands the operator the target's identity AND their own platform
 * powers — and no per-route check catches it, because no per-route check runs.
 */

const IMPERSONATION: ActorImpersonation = {
  kind: 'preview',
  tenantId: 'client-1',
  realUserId: 'real',
  previewRoleName: null,
  subjectUserId: 'target',
};

function resolverOver(over: Partial<EffectiveActorConfig> = {}) {
  const config: EffectiveActorConfig = {
    resolveIdentity: async () => ({
      email: 'op@example.com',
      userId: 'real',
      isPlatformAdmin: false,
    }),
    readImpersonation: async () => null,
    ...over,
  };
  return createEffectiveActor(config);
}

describe('createEffectiveActor', () => {
  it('answers anonymous with no session', async () => {
    const resolve = resolverOver({
      resolveIdentity: async () => ({ email: null, userId: null, isPlatformAdmin: false }),
    });
    expect(await resolve()).toEqual({
      email: null,
      userId: null,
      isSuper: false,
      realUserId: null,
      impersonation: null,
    });
  });

  it('passes an ordinary caller through unchanged', async () => {
    expect(await resolverOver()()).toMatchObject({
      userId: 'real',
      realUserId: 'real',
      isSuper: false,
      impersonation: null,
    });
  });

  it('DROPS platform authority while impersonating — never unions it', async () => {
    // The single most important line. With `isSuper` left true, every guard
    // short-circuits and answers the whole catalog while wearing the target's
    // identity.
    const resolve = resolverOver({
      resolveIdentity: async () => ({
        email: 'op@example.com',
        userId: 'real',
        isPlatformAdmin: true,
      }),
      readImpersonation: async () => IMPERSONATION,
    });
    const actor = await resolve();
    expect(actor.isSuper).toBe(false);
    expect(actor.userId).toBe('target');
    expect(actor.realUserId).toBe('real');
  });

  it('keeps platform authority when nobody is being impersonated', async () => {
    const resolve = resolverOver({
      resolveIdentity: async () => ({
        email: 'op@example.com',
        userId: 'p1',
        isPlatformAdmin: true,
      }),
    });
    expect((await resolve()).isSuper).toBe(true);
  });

  it('never starts a session for an actor with no resolvable user id', async () => {
    // Nothing could be attributed to them, so they keep acting as their own
    // unimpersonated self rather than starting a session nobody can be blamed
    // for.
    const readImpersonation = vi.fn(async () => IMPERSONATION);
    const resolve = resolverOver({
      resolveIdentity: async () => ({
        email: 'op@example.com',
        userId: null,
        isPlatformAdmin: true,
      }),
      readImpersonation,
    });
    const actor = await resolve();
    expect(actor.impersonation).toBeNull();
    expect(readImpersonation).not.toHaveBeenCalled();
  });

  it('revokes an OPERATOR session whose owner lost platform authority', async () => {
    // The only exit otherwise clears a cookie held by the one browser nobody
    // can reach any more.
    const resolve = resolverOver({
      readImpersonation: async () => ({ ...IMPERSONATION, kind: 'operator' }),
      stillHoldsPlatformAuthority: async () => false,
    });
    const actor = await resolve();
    expect(actor.impersonation).toBeNull();
    expect(actor.userId).toBe('real');
  });

  it('does NOT re-check a preview — its ceiling already degrades per request', async () => {
    // Only the unbounded kind has an authority that can go stale.
    const check = vi.fn(async () => false);
    const resolve = resolverOver({
      readImpersonation: async () => IMPERSONATION,
      stillHoldsPlatformAuthority: check,
    });
    expect((await resolve()).impersonation).not.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('treats an omitted revocation check as "never revoked"', async () => {
    // Correct for a host with no unbounded kind at all.
    const resolve = resolverOver({
      readImpersonation: async () => ({ ...IMPERSONATION, kind: 'operator' }),
    });
    expect((await resolve()).impersonation).not.toBeNull();
  });

  it('forwards the request to both ports', async () => {
    const resolveIdentity = vi.fn(async () => ({
      email: 'a@b.c',
      userId: 'real',
      isPlatformAdmin: false,
    }));
    const readImpersonation = vi.fn(async () => null);
    const request = new Request('https://app.example.com/');
    await resolverOver({ resolveIdentity, readImpersonation })(request);
    expect(resolveIdentity).toHaveBeenCalledWith(request);
    expect(readImpersonation).toHaveBeenCalledWith('real', request);
  });
});

describe('attributionOf', () => {
  it('names the REAL human as the actor, with the target alongside', async () => {
    const actor = await resolverOver({ readImpersonation: async () => IMPERSONATION })();
    expect(attributionOf(actor)).toEqual({
      actorUserId: 'real',
      onBehalfOfUserId: 'target',
    });
  });

  it('CLEARS the target explicitly when nobody is impersonated', () => {
    // `null`, not `undefined`: a merging writer reads `undefined` as "leave
    // what an earlier guard set", which strands a stale target for the rest of
    // the request — including the request that ENDS a session.
    const attribution = attributionOf({
      userId: 'u1',
      realUserId: 'u1',
      impersonation: null,
    });
    expect(attribution.onBehalfOfUserId).toBeNull();
    expect(attribution).not.toHaveProperty('onBehalfOfUserId', undefined);
  });

  it('answers an empty actor id rather than null for a rowless platform actor', () => {
    expect(attributionOf({ userId: null, realUserId: null, impersonation: null })).toEqual({
      actorUserId: '',
      onBehalfOfUserId: null,
    });
  });
});
