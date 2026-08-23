/**
 * The tenant-ROLE authority axis: "does this caller hold one of these roles on
 * this tenant?" — the gate a large host puts in front of most of its admin
 * routes.
 *
 * It is a genuinely DIFFERENT axis from the permission guards in `./guards`.
 * That one narrows permission STRINGS and has no opinion about a membership
 * tier, so a host that narrowed only it would leave every role-gated route
 * deciding on the impersonator's own tier. Both axes have to resolve the same
 * actor and bound the same session, and the way that goes wrong is well
 * documented: a host had TWO authority resolvers, the impersonation seam landed
 * in one of them, and the other went on short-circuiting on the real session's
 * platform allowlist. A support operator impersonating a waiter still passed
 * the admin gate, and every attribution on that family stamped a plain
 * platform-admin action into an append-only audit table.
 *
 * The fix is not "check impersonation in the other guard too" — that produces a
 * third resolver the first time someone adds a guard, and the missing check is
 * invisible in review because the missing thing is not there to see. The fix is
 * that BOTH axes sit on ONE resolved actor, and that the order below is stated
 * once, here, rather than per host.
 *
 * THE ORDER IS LOAD-BEARING:
 *
 *   1. RESOLVE THE ACTOR — one call, shared with the permission guards, so the
 *      two axes can never disagree about who this request is.
 *   2. REFUSE A SESSION REACHING OUTSIDE ITS TENANT — checked BEFORE anything
 *      can grant, and through the same {@link outsideBoundedTenant} the ceiling
 *      uses, so both axes bound a session identically.
 *   3. THE PLATFORM SHORT-CIRCUIT — reachable only when `isSuper` survived,
 *      and a host resolving an impersonated actor forces that false. That
 *      single fact is the escalation fix: there is no allowlist check here for
 *      an impersonated request to sail through.
 *   4. THE SUBJECT'S OWN TIER, narrowed by any preview.
 */

import { outsideBoundedTenant, type CeilingImpersonation } from './impersonation-ceiling';

/** The resolved actor both axes share. */
export interface TenantGuardActor {
  /** The identity everything is derived from; `null` when not signed in. */
  email: string | null;
  /**
   * The EFFECTIVE subject — the impersonated user while a session is in force,
   * the caller otherwise. `null` for a platform actor admitted by an allowlist
   * with no user row of their own.
   */
  userId: string | null;
  /** Platform authority. MUST be false while an impersonation is in force. */
  isSuper: boolean;
  /** The real human whose credentials authorized the request (attribution). */
  realUserId: string | null;
  /** The impersonation in force, or `null`. */
  impersonation: CeilingImpersonation | null;
}

/** The resolved authority: a role on the tenant, or platform authority. */
export interface TenantGrant<TRole extends string> {
  /**
   * The EFFECTIVE subject's user id. Deliberately `''` for a platform grant
   * whose email has no user row, and that id is never used for a write.
   */
  userId: string;
  email: string;
  role: TRole | 'PLATFORM';
  /**
   * The REAL human. Carried on the grant because attribution needs BOTH ids:
   * without it a call site cannot express "the operator did this, acting as
   * the owner", and writes the impersonated id as the actor instead.
   */
  realUserId: string | null;
  impersonation: CeilingImpersonation | null;
}

/**
 * A resolved OUTCOME rather than `TenantGrant | null`, because the guards
 * disagree about what a refusal MEANS: a throwing guard must distinguish 401
 * from 403 (a signed-out caller has to be told to sign in, not that they lack
 * permission), while a predicate collapses both to `false`. Encoding the reason
 * is what lets ONE body serve both — and one body is the point, since a
 * duplicated pair is how the platform short-circuit came to exist twice and get
 * fixed zero times.
 */
export type TenantGrantOutcome<TRole extends string> =
  | { ok: true; grant: TenantGrant<TRole> }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' };

export interface TenantGuardsConfig<TRole extends string> {
  /** WHO is calling — the same resolver the permission guards use. */
  resolveActor: () => Promise<TenantGuardActor>;
  /**
   * The tier the SUBJECT acts at on this tenant, already narrowed by any
   * preview. Host-owned: it reads the host's membership table and its own role
   * vocabulary, and a preview may only ever subtract.
   */
  resolveTier: (
    userId: string,
    tenantId: string,
    impersonation: CeilingImpersonation | null,
  ) => Promise<TRole | null>;
  /** Which scopes the tenant bound does not apply to. */
  isUnboundedScope: (scope: string) => boolean;
  /** The roles a guard defaults to when the caller names none. */
  defaultRoles: readonly TRole[];
}

/**
 * Build the tenant guards.
 *
 * Every refusal is returned rather than thrown, so a host maps them onto its
 * own error types and its own words — this package has no opinion about either.
 */
export function createTenantGuards<TRole extends string>(config: TenantGuardsConfig<TRole>) {
  /** THE decision — the single body behind every guard below. */
  async function resolveTenantGrant(
    tenantId: string,
    roles: readonly TRole[],
  ): Promise<TenantGrantOutcome<TRole>> {
    const actor = await config.resolveActor();
    if (!actor.email) return { ok: false, reason: 'unauthenticated' };

    const { impersonation } = actor;
    if (
      impersonation &&
      outsideBoundedTenant(impersonation, tenantId, config.isUnboundedScope)
    ) {
      return { ok: false, reason: 'forbidden' };
    }

    if (actor.isSuper) {
      return {
        ok: true,
        grant: {
          userId: actor.realUserId ?? '',
          email: actor.email,
          role: 'PLATFORM',
          realUserId: actor.realUserId,
          // Read off the actor rather than hard-coded `null`, so the two can
          // never drift: this branch is unreachable while impersonating only
          // because the caller forced `isSuper` false.
          impersonation: actor.impersonation,
        },
      };
    }

    // Signed in, but no user row and no platform authority: there is no
    // identity to key a membership to. Historically a 401 and it stays one — a
    // 403 would tell a half-provisioned account it lacks permission it might
    // well have.
    if (!actor.userId) return { ok: false, reason: 'unauthenticated' };

    const role = await config.resolveTier(actor.userId, tenantId, impersonation);
    if (role === null || !roles.includes(role)) return { ok: false, reason: 'forbidden' };
    return {
      ok: true,
      grant: {
        userId: actor.userId,
        email: actor.email,
        role,
        realUserId: actor.realUserId,
        impersonation,
      },
    };
  }

  return {
    resolveTenantGrant,
    /**
     * The grant, or the reason there is none. A host throws its own errors from
     * the reason; the platform actor short-circuits to every tenant UNLESS an
     * impersonation is live, in which case the target's own membership decides.
     */
    requireTenantRole: (tenantId: string, roles: readonly TRole[] = config.defaultRoles) =>
      resolveTenantGrant(tenantId, roles),
    /**
     * Non-throwing "may this caller administer the tenant?", for read paths
     * that conditionally show an admin affordance. Shares the body above
     * verbatim, so it cannot drift from it; only the refusal mapping differs.
     */
    canAdminTenant: async (
      tenantId: string,
      roles: readonly TRole[] = config.defaultRoles,
    ): Promise<boolean> => (await resolveTenantGrant(tenantId, roles)).ok,
  };
}
