import type { Rbac } from '../core/engine';
import { PermissionDeniedError } from '../core/errors';
import type { VisibleResult } from '../core/types';

import {
  GLOBAL_SCOPE,
  RbacApiError,
  messagesOf,
  type RbacMessages,
  type RbacServerConfig,
} from './context';
import { mergeVisibleResults, type ListVisibility } from './visible';

/**
 * The guard helpers (12-13) — ported from future-pay's `lib/rbac/guards.ts`,
 * with one deliberate signature change: WHO is asking arrives as an argument
 * instead of being read from an ambient session. Resolving the session is the
 * host's half of the port ("who is calling"); everything after that — the
 * engine delegation, the superadmin short-circuit, the ceiling intersection,
 * the tier merge — is the package's, and lives here once.
 */

/** The already-resolved subject a guard decides about. */
export interface RbacGuardActor {
  /** The DB user id, or `null` (unresolved / env-allowlist admin). */
  userId: string | null;
  /** Platform operator — allowed everywhere, holds the whole catalog. */
  isSuper: boolean;
  /**
   * An optional permission CEILING (impersonation previews): a resolved set is
   * intersected with it, so it can only ever NARROW, never grant.
   */
  permissionCeiling?: ReadonlySet<string> | null;
}

/** Options shared by the permission guards. */
export interface RbacPermissionOptions {
  /** The scope the decision is made in. Defaults to {@link GLOBAL_SCOPE}. */
  scope?: string;
  /** The instance id for an INSTANCE permission; omit for a CLASS action. */
  resource?: string | null;
  /** Extra ABAC context threaded to caveats. */
  context?: Record<string, unknown>;
}

/** The LIST verdict plus WHO it was resolved for. */
export interface ListVisibilityForActor extends ListVisibility {
  actorUserId: string | null;
}

export interface RbacGuards<P extends string = string> {
  /**
   * Throwing authorization guard: allows a platform admin unconditionally, an
   * unresolved user is denied, everyone else is checked by the engine.
   * Throws a user-safe 403 {@link RbacApiError}.
   */
  requirePermission(
    actor: RbacGuardActor,
    action: P,
    opts?: RbacPermissionOptions,
  ): Promise<void>;
  /** Non-throwing point check. */
  can(actor: RbacGuardActor, action: P, opts?: RbacPermissionOptions): Promise<boolean>;
  /**
   * The permission strings the actor holds in `scope` — for nav filtering and
   * the React `RbacProvider`. A platform admin holds every catalog entry; an
   * unresolved actor holds none; a ceiling intersects the resolved set.
   */
  getActorPermissions(actor: RbacGuardActor, scope?: string): Promise<Set<P>>;
  /** LIST seam: which instances of `type` may the actor act on under `action`? */
  visibleResources(
    actor: RbacGuardActor,
    action: P,
    type: string,
    opts?: RbacPermissionOptions,
  ): Promise<VisibleResult>;
  /**
   * LIST seam over a TIERED read surface: one {@link visibleResources} verdict
   * per tier, merged — any class tier yields `all`; instance tiers OR-unite.
   * `authorized: false` is the 403 signal; `where: null` an empty page.
   */
  listVisibility(
    actor: RbacGuardActor,
    actions: readonly P[],
    type: string,
    opts?: RbacPermissionOptions,
  ): Promise<ListVisibilityForActor>;
}

/** Build the engine's context from the guard options (scope + ABAC bag). */
function checkContext(opts: RbacPermissionOptions): Record<string, unknown> {
  // Spread the caller's ABAC bag FIRST, then set `scope` last so a `scope`
  // key inside `opts.context` can NEVER override the decision scope.
  return { ...(opts.context ?? {}), scope: opts.scope ?? GLOBAL_SCOPE };
}

/** Is `action` outside the actor's ceiling? Pure subtraction — never grants. */
function outsideCeiling(actor: RbacGuardActor, action: string): boolean {
  const ceiling = actor.permissionCeiling ?? null;
  return ceiling !== null && !ceiling.has(action);
}

/**
 * The structural belt for "impersonating means NOT super". Every guard
 * short-circuits on `isSuper` before any other check runs, so a host that
 * forgot to force it false while carrying a ceiling would get the UNION —
 * silently, on every route at once (future-pay calls its equivalent line
 * "the single most important line in this feature"). A ceiling and platform
 * authority are never both meaningful: the ceiling wins.
 */
function normalized(actor: RbacGuardActor): RbacGuardActor {
  if (!actor.isSuper || !actor.permissionCeiling) return actor;
  return { ...actor, isSuper: false };
}

/**
 * Intersect a resolved permission set with a ceiling — the one expression of
 * "a preview may only ever NARROW". A `null`/absent ceiling passes the set
 * through unchanged.
 */
export function intersectPermissions<P extends string>(
  permissions: ReadonlySet<P>,
  ceiling: ReadonlySet<string> | null | undefined,
): Set<P> {
  if (!ceiling) return new Set(permissions);
  const narrowed = new Set<P>();
  for (const permission of permissions) {
    if (ceiling.has(permission)) narrowed.add(permission);
  }
  return narrowed;
}

interface GuardCtx<P extends string> {
  engine: Rbac<P>;
  permissions: RbacServerConfig<P>['catalog']['permissions'];
  warmScope: RbacServerConfig<P>['warmScope'];
  messages: RbacMessages;
}

async function warm<P extends string>(
  ctx: GuardCtx<P>,
  opts: RbacPermissionOptions,
): Promise<void> {
  if (opts.scope && ctx.warmScope) await ctx.warmScope(opts.scope);
}

async function requirePermission<P extends string>(
  ctx: GuardCtx<P>,
  actor: RbacGuardActor,
  action: P,
  opts: RbacPermissionOptions = {},
): Promise<void> {
  // Platform admin — allowed everywhere, no lockout, no `users` row needed.
  if (actor.isSuper) return;
  if (!actor.userId) throw new RbacApiError(403, ctx.messages.forbidden);
  await warm(ctx, opts);
  // A ceiling may only ever narrow; the engine still makes the real decision
  // below — instance gate, caveats and all.
  if (outsideCeiling(actor, action)) throw new RbacApiError(403, ctx.messages.forbidden);
  try {
    await ctx.engine.requirePermission(
      actor.userId,
      action,
      opts.resource ?? null,
      checkContext(opts),
    );
  } catch (error) {
    // The engine's error carries an internal, id-leaking message; the wire
    // gets the user-safe copy instead.
    if (error instanceof PermissionDeniedError) {
      throw new RbacApiError(403, ctx.messages.forbidden);
    }
    throw error;
  }
}

async function getActorPermissions<P extends string>(
  ctx: GuardCtx<P>,
  actor: RbacGuardActor,
  scope: string,
): Promise<Set<P>> {
  // A platform admin holds EVERY permission in the catalog — the widest
  // answer this surface can produce.
  if (actor.isSuper) return new Set<P>(ctx.permissions.list);
  if (!actor.userId) return new Set<P>();
  if (ctx.warmScope) await ctx.warmScope(scope);
  const permissions = await ctx.engine.getPermissions(actor.userId, scope);
  return intersectPermissions(permissions, actor.permissionCeiling);
}

async function visibleResources<P extends string>(
  ctx: GuardCtx<P>,
  actor: RbacGuardActor,
  action: P,
  type: string,
  opts: RbacPermissionOptions = {},
): Promise<VisibleResult> {
  if (actor.isSuper) return { kind: 'all' };
  if (!actor.userId) return { kind: 'none' };
  await warm(ctx, opts);
  // Same narrowing as requirePermission: a preview that does not hold the
  // action reaches no instances of it.
  if (outsideCeiling(actor, action)) return { kind: 'none' };
  return ctx.engine.visibleResources(actor.userId, action, type, checkContext(opts));
}

async function listVisibility<P extends string>(
  ctx: GuardCtx<P>,
  actor: RbacGuardActor,
  actions: readonly P[],
  type: string,
  opts: RbacPermissionOptions = {},
): Promise<ListVisibilityForActor> {
  if (actor.isSuper) {
    return { authorized: true, where: {}, actorUserId: actor.userId };
  }
  if (!actor.userId) return { authorized: false, where: null, actorUserId: null };
  await warm(ctx, opts);
  const userId = actor.userId;
  // Tiers outside the ceiling drop out of the fan-out entirely. With none
  // left, `mergeVisibleResults([])` answers `authorized: false` — the
  // surface's 403, and the right one.
  const ceiling = actor.permissionCeiling ?? null;
  const reachable = ceiling ? actions.filter((action) => ceiling.has(action)) : actions;
  const results = await Promise.all(
    reachable.map((action) =>
      ctx.engine.visibleResources(userId, action, type, checkContext(opts)),
    ),
  );
  return { ...mergeVisibleResults(results), actorUserId: userId };
}

type GuardConfig<P extends string> = Pick<
  RbacServerConfig<P>,
  'catalog' | 'warmScope' | 'messages'
>;

export function createRbacGuards<P extends string>(
  engine: Rbac<P>,
  config: GuardConfig<P>,
): RbacGuards<P> {
  const ctx: GuardCtx<P> = {
    engine,
    permissions: config.catalog.permissions,
    warmScope: config.warmScope,
    messages: messagesOf(config),
  };
  return {
    requirePermission: (actor, action, opts) =>
      requirePermission(ctx, normalized(actor), action, opts),
    can: async (actor, action, opts) => {
      try {
        await requirePermission(ctx, normalized(actor), action, opts);
        return true;
      } catch (error) {
        if (error instanceof RbacApiError && error.status === 403) return false;
        throw error;
      }
    },
    getActorPermissions: (actor, scope = GLOBAL_SCOPE) =>
      getActorPermissions(ctx, normalized(actor), scope),
    visibleResources: (actor, action, type, opts) =>
      visibleResources(ctx, normalized(actor), action, type, opts),
    listVisibility: (actor, actions, type, opts) =>
      listVisibility(ctx, normalized(actor), actions, type, opts),
  };
}
