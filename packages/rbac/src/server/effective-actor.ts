/**
 * WHO does this request act as, with what authority, and on whose behalf —
 * asked once, answered once.
 *
 * This is the function BOTH authority axes sit on: the permission guards in
 * `./guards` and the tenant-role guards in `./tenant-guards`. That is the whole
 * design. A host that resolves authority in two places will eventually apply an
 * impersonation to one of them, and the other goes on answering from the real
 * session — which is not hypothetical, it is the escalation both of those
 * modules document. Sitting them on one resolver means a new guard inherits the
 * safe behaviour by its author doing nothing at all.
 *
 * WHAT STAYS THE HOST'S, and why each one cannot live here:
 *
 * - `resolveIdentity` — reading a session, resolving it to a user row, and
 *   deciding platform authority are all the host's, and the id it resolves is
 *   its own (a session's subject claim is usually NOT the host's user id).
 * - `readImpersonation` — the cookie's name, its cipher and its time box belong
 *   to whatever mints it, and the host collapses that package's union into the
 *   fields here. It is also where a host's own vocabulary is adapted.
 *
 * WHAT DOES NOT stay the host's, and is the reason this module exists: the
 * SWAP. Substituting the subject and dropping platform authority is one rule
 * with one correct order, and every host that writes it writes the same three
 * lines — until one of them forgets the second.
 */

import type { CeilingImpersonation } from './impersonation-ceiling';

/** The impersonation as the ACTOR resolver needs it: the ceiling's fields plus who to BE. */
export interface ActorImpersonation extends CeilingImpersonation {
  /**
   * The user id every authorization question is asked about — the whole feature
   * in one field. For a ROLE preview there is no such person, so it stays the
   * actor and `previewRoleName` does the narrowing instead.
   */
  subjectUserId: string;
}

/**
 * The resolved authorization actor for a request.
 *
 * Generic over the impersonation so a host's own state survives the round trip.
 * `TImp` is only ever WIDER than {@link ActorImpersonation} — a host that mints
 * sessions carries fields the swap has no opinion about (whether writes were
 * opted into, which operator approved it, what the banner should say), and this
 * resolver is the one place all of them pass through. Fixing the field to the
 * minimum would force every such host to re-attach its own fields on the way
 * out, from a value it had already assembled correctly on the way in — which is
 * a translation layer bought for nothing, and the exact shape this package
 * exists to stop a host from writing.
 */
export interface EffectiveActor<TImp extends ActorImpersonation = ActorImpersonation> {
  /** The session identity everything is derived from. */
  email: string | null;
  /**
   * The EFFECTIVE subject: the impersonated user while a session is in force,
   * the real human otherwise. The field keeps its meaning for every consumer,
   * which is why substituting it is enough. `null` for a platform actor with no
   * user row of their own.
   */
  userId: string | null;
  /**
   * Platform authority. FORCED FALSE while impersonating — see the rule in
   * {@link createEffectiveActor}.
   */
  isSuper: boolean;
  /**
   * The real human whose credentials authorized the request. Attribution always
   * names THIS id; the impersonated identity is recorded alongside it, never
   * instead.
   */
  realUserId: string | null;
  /** The impersonation in force, or `null`. */
  impersonation: TImp | null;
}

/** What the host resolves from its own session and user store. */
export interface ResolvedIdentity {
  email: string | null;
  /** The HOST's user id, resolved from the session — not the subject claim. */
  userId: string | null;
  /** Platform authority for this identity, from whatever the host trusts. */
  isPlatformAdmin: boolean;
}

export interface EffectiveActorConfig<TImp extends ActorImpersonation = ActorImpersonation> {
  /** The session identity, resolved fresh per request. */
  resolveIdentity: (request?: Request) => Promise<ResolvedIdentity>;
  /**
   * The impersonation in force for this request, already collapsed into
   * {@link ActorImpersonation}. Answers `null` on every doubt.
   */
  readImpersonation: (realUserId: string, request?: Request) => Promise<TImp | null>;
  /**
   * THE REVOCATION PATH, and it is only ever asked of the unbounded kind.
   *
   * An `operator` session names its target at MINT time and depends on nothing
   * about the actor's live rights, so without this it outlives the authority
   * that created it: someone removed from the platform allowlist keeps acting
   * as the target for the rest of the time box, and there is no other way to
   * end it — the only exit clears a cookie held by the one browser nobody can
   * reach any more.
   *
   * The preview kinds need no equivalent: their ceiling is re-read from the
   * engine on every request, so they degrade the moment a grant is removed.
   * Only the unbounded kind has an authority that can go stale.
   *
   * Omitted means "never revoked", which is correct for a host with no
   * unbounded kind at all.
   */
  stillHoldsPlatformAuthority?: (
    impersonation: TImp,
    identity: ResolvedIdentity,
  ) => Promise<boolean> | boolean;
}

// `never` for the impersonation, not the default: this value is returned from
// every instantiation, and `EffectiveActor<ActorImpersonation>` would not be
// assignable to a host's narrower one. `never | null` is exactly `null`, which
// is what an anonymous actor's impersonation is under any TImp.
const ANONYMOUS: EffectiveActor<never> = {
  email: null,
  userId: null,
  isSuper: false,
  realUserId: null,
  impersonation: null,
};

/**
 * Build the resolver.
 *
 * *** THE SINGLE MOST IMPORTANT LINE IS `isSuper: false`. ***
 *
 * The impersonator's own platform authority is DROPPED, never unioned with the
 * target's rights. Every guard short-circuits on `isSuper` before it asks
 * anything else — the permission guards answer the entire catalog on that
 * branch, and the tenant guards return a grant for every tenant without so much
 * as a membership lookup. Leaving it true would mean an operator "seeing what
 * the owner sees" while silently keeping the power only the platform owner has.
 * No per-route check could catch that afterwards, because no per-route check
 * ever runs: the short-circuit returns first.
 *
 * The revocation refusal lives HERE rather than one level up because a host's
 * write gate reads the same impersonation directly. A check placed above would
 * let the gate and the guards disagree about whether a session exists at all:
 * the guards would treat a revoked operator as their own ordinary self while
 * the gate went on refusing their writes as impersonated — a lockout with no
 * visible cause and no exit.
 */
export function createEffectiveActor<TImp extends ActorImpersonation = ActorImpersonation>(
  config: EffectiveActorConfig<TImp>,
) {
  return async function resolveEffectiveActor(
    request?: Request,
  ): Promise<EffectiveActor<TImp>> {
    const identity = await config.resolveIdentity(request);
    if (!identity.email) return ANONYMOUS;

    const base: EffectiveActor<TImp> = {
      email: identity.email,
      userId: identity.userId,
      isSuper: identity.isPlatformAdmin,
      realUserId: identity.userId,
      impersonation: null,
    };

    // Without a resolvable user id there is nothing an impersonation could be
    // attributed to, so such an actor keeps acting as their own unimpersonated
    // self rather than starting a session nobody can be blamed for.
    if (!identity.userId) return base;

    const impersonation = await config.readImpersonation(identity.userId, request);
    if (!impersonation) return base;

    if (
      impersonation.kind === 'operator' &&
      config.stillHoldsPlatformAuthority &&
      !(await config.stillHoldsPlatformAuthority(impersonation, identity))
    ) {
      return base;
    }

    return {
      email: identity.email,
      // Ask the engine about the TARGET and their assignments, custom roles and
      // caveats all resolve for free — the resolvers are keyed on exactly this
      // id, and the tenant guards read the same one for the membership tier.
      userId: impersonation.subjectUserId,
      isSuper: false,
      realUserId: identity.userId,
      impersonation,
    };
  };
}

/** The two ids an attribution stamp needs, whatever the host's writer is called. */
export interface ActorAttribution {
  /** The REAL human — "who actually did this". */
  actorUserId: string;
  /**
   * The impersonated identity, riding ALONGSIDE the actor rather than instead
   * of it. `null` — not `undefined` — when nobody is being impersonated: a
   * merging writer treats `undefined` as "leave what an earlier guard set",
   * which would leave a stale target standing for the rest of the request. An
   * explicit clear is what makes the trail of the request that ENDS a session
   * read as the real human again.
   */
  onBehalfOfUserId: string | null;
}

/**
 * The attribution for an actor. Structural on purpose: an {@link EffectiveActor}
 * satisfies it, and so does a resolved tenant grant — the two authority
 * families attribute through the SAME function rather than each assembling a
 * stamp of its own, which is how one of them came to write platform-attributed
 * rows for impersonated actions.
 */
export function attributionOf(actor: {
  userId: string | null;
  realUserId: string | null;
  impersonation: unknown | null;
}): ActorAttribution {
  return {
    actorUserId: actor.realUserId ?? '',
    onBehalfOfUserId: actor.impersonation ? actor.userId : null,
  };
}
