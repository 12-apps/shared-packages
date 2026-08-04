import type {
  AuthzAdapter,
  AuthzContext,
  RbacConfig,
  RoleAssignment,
  Scope,
  VisibleResult,
} from './types';
import { buildRoleIndex } from './roles';
import { canWith, permissionsFor, type CanContext } from './can';
import { createDefaultAdapter } from './adapter';
import { PermissionDeniedError } from './errors';

/**
 * Context threaded into the converged {@link Rbac.can} /
 * {@link Rbac.visibleResources}. `scope` selects which scope the decision is
 * made in; the rest is the host attribute bag consumed by ABAC caveats.
 */
export interface CheckContext extends AuthzContext {
  scope?: Scope;
}

/** The engine returned by {@link createRbac}. `P` is the permission union. */
export interface Rbac<P extends string> {
  // ----- converged, adapter-delegating surface (preferred call sites) -----
  /**
   * Point check via the adapter. `resource` is the instance id for INSTANCE
   * permissions, or `null` for a CLASS action. `context.scope` selects the
   * scope (defaults to the configured `defaultScope`/`globalScope`).
   */
  can(
    subject: string,
    action: P,
    resource?: string | null,
    context?: CheckContext,
  ): Promise<boolean>;
  /** LIST seam via the adapter: which instances of `type` may the subject act on? */
  visibleResources(
    subject: string,
    action: P,
    type: string,
    context?: CheckContext,
  ): Promise<VisibleResult>;
  /** Throw {@link PermissionDeniedError} when the point check fails. */
  requirePermission(
    subject: string,
    action: P,
    resource?: string | null,
    context?: CheckContext,
  ): Promise<void>;

  // ----- lower-level surface (kept for existing call sites) -----
  /** All permissions the actor holds in `scope`. */
  getPermissions(
    actorId: string,
    scope: Scope,
    context?: AuthzContext,
  ): Promise<Set<P>>;
  /** Sync escape hatch when the host already resolved the assignments. */
  canWithAssignments(
    assignments: readonly RoleAssignment[],
    permission: P,
    scope: Scope,
    context?: AuthzContext,
  ): boolean;
  /** The Policy Decision Point in use (default adapter unless overridden). */
  readonly adapter: AuthzAdapter;
}

/**
 * Build an RBAC engine from a config. The role index (name -> expanded
 * permission map) is computed once here; every check reuses it. Decisions are
 * delegated to `config.adapter` (default: the built-in SQL/in-process adapter).
 */
export function createRbac<P extends string>(config: RbacConfig<P>): Rbac<P> {
  const globalScope = config.globalScope ?? 'GLOBAL';
  const defaultScope = config.defaultScope ?? globalScope;
  const roleIndex = buildRoleIndex(config.roles);
  const can: CanContext = {
    roleIndex,
    globalScope,
    allPermissions: config.permissions.list,
    scopeParent: config.scopeParent,
  };

  const resolve = async (
    actorId: string,
  ): Promise<readonly RoleAssignment[]> => await config.resolver(actorId);

  const scopeOf = (context: AuthzContext): Scope => {
    const s = (context as CheckContext).scope;
    return typeof s === 'string' ? s : defaultScope;
  };

  const adapter: AuthzAdapter =
    config.adapter ??
    createDefaultAdapter<P>({
      permissions: config.permissions,
      can,
      resolve,
      scopeOf,
      ownership: config.ownership,
      assignmentResolver: config.assignmentResolver,
    });

  return {
    adapter,

    async can(subject, action, resource = null, context = {}) {
      return await adapter.check(subject, action, resource ?? null, context);
    },

    async visibleResources(subject, action, type, context = {}) {
      return await adapter.visible(subject, action, type, context);
    },

    async requirePermission(subject, action, resource = null, context = {}) {
      const ok = await adapter.check(subject, action, resource ?? null, context);
      if (!ok) {
        throw new PermissionDeniedError(subject, action, scopeOf(context));
      }
    },

    async getPermissions(actorId, scope, context = {}) {
      const assignments = await resolve(actorId);
      return permissionsFor(assignments, scope, { ...can, context }) as Set<P>;
    },

    canWithAssignments(assignments, permission, scope, context = {}) {
      return canWith(assignments, permission, scope, { ...can, context });
    },
  };
}

