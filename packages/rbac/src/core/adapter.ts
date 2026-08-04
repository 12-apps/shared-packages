import type {
  AuthzAdapter,
  AuthzContext,
  OwnershipPredicate,
  PermissionRegistry,
  RoleAssignment,
  Scope,
  VisibleResult,
} from './types';
import { canWith, type CanContext } from './can';

/**
 * Everything the default adapter needs, resolved once by {@link createRbac}.
 * Kept separate from {@link RbacConfig} so the adapter is a pure function of
 * already-built pieces (role index, resolvers) — no re-derivation per call.
 */
export interface DefaultAdapterDeps<P extends string> {
  permissions: PermissionRegistry<P>;
  can: CanContext;
  resolve: (actorId: string) => Promise<readonly RoleAssignment[]>;
  /** The scope a decision is made in (extracted from context or defaulted). */
  scopeOf: (context: AuthzContext) => Scope;
  ownership?: (
    subject: string,
    resourceType: string,
  ) => OwnershipPredicate | null;
  assignmentResolver?: (
    subject: string,
    resourceType: string,
    context: AuthzContext,
  ) => string[] | Promise<string[]>;
}

/** Split `type:...` off an action to get its resource type (`orders:read:own` -> `orders`). */
export function resourceTypeOf(action: string): string {
  const idx = action.indexOf(':');
  return idx === -1 ? action : action.slice(0, idx);
}

/** Does the RBAC layer grant this action in this scope? */
function rbacGrants<P extends string>(
  deps: DefaultAdapterDeps<P>,
  assignments: readonly RoleAssignment[],
  action: string,
  scope: Scope,
  context: AuthzContext,
): boolean {
  return canWith(assignments, action, scope, { ...deps.can, context });
}

/**
 * Does an in-process ownership predicate hold for `resourceId`? A 'field'
 * descriptor cannot be evaluated without the row (the SQL host expresses it as
 * a WHERE clause via `visible`), so a point check conservatively denies here
 * and lets the assignment relation / caveat decide.
 */
function ownershipHolds(
  pred: OwnershipPredicate | null,
  resourceId: string,
): boolean {
  if (pred === null) return false;
  if (pred.kind === 'predicate') return pred.test(resourceId);
  return false;
}

/**
 * Build the `VisibleResult` for an INSTANCE permission from the caller's owned
 * (predicate) and assigned (concrete id) reach. Extracted from `visible` so its
 * predicate/id branch logic stays under the complexity bar.
 */
function instanceVisible(
  pred: OwnershipPredicate | null,
  ids: Set<string>,
  subject: string,
): VisibleResult {
  if (pred && pred.kind === 'field') {
    // Field ownership is unbounded (all rows where owner==subject); express it
    // as a predicate the SQL host ANDs into its query, unioned with any
    // concrete assigned ids.
    return {
      kind: 'predicate',
      predicate: { ownerField: pred.field, subject, orIds: [...ids] },
    };
  }
  if (pred && pred.kind === 'predicate') {
    // Cannot enumerate rows in-process; hand back the assigned ids plus the
    // predicate for the host to apply.
    if (ids.size === 0) {
      return { kind: 'predicate', predicate: { test: pred.test } };
    }
    return {
      kind: 'predicate',
      predicate: { test: pred.test, orIds: [...ids] },
    };
  }
  return { kind: 'ids', ids: [...ids] };
}

/**
 * The built-in SQL / in-process Policy Decision Point.
 *
 * - CLASS permission: RBAC alone decides (both seams). `visible` is `all` when
 *   held, `none` otherwise.
 * - INSTANCE permission: RBAC is the first gate; a second ENTITY gate then
 *   requires ownership OR membership in the assignment relation (OR a caveat
 *   already folded into the RBAC check). `visible` returns the union as ids or
 *   an ownership predicate.
 *
 * An OpenFGA adapter would implement the same {@link AuthzAdapter} interface
 * (`check` -> Check, `visible` -> ListObjects) and slot in via `config.adapter`.
 */
export function createDefaultAdapter<P extends string>(
  deps: DefaultAdapterDeps<P>,
): AuthzAdapter {
  const { permissions, resolve, scopeOf, ownership, assignmentResolver } = deps;

  return {
    async check(subject, action, resource, context) {
      const scope = scopeOf(context);
      const assignments = await resolve(subject);
      if (!rbacGrants(deps, assignments, action, scope, context)) return false;

      // Class permission (or a class action with no resource): RBAC is enough.
      if (permissions.kind(action) === 'class' || resource === null) {
        return true;
      }

      // Instance permission: run the entity gate.
      const resourceType = resourceTypeOf(action);
      const pred = ownership ? ownership(subject, resourceType) : null;
      if (ownershipHolds(pred, resource)) return true;

      if (assignmentResolver) {
        const assigned = await assignmentResolver(
          subject,
          resourceType,
          context,
        );
        if (assigned.includes(resource)) return true;
      }
      return false;
    },

    async visible(subject, action, resourceType, context): Promise<VisibleResult> {
      const scope = scopeOf(context);
      const assignments = await resolve(subject);
      if (!rbacGrants(deps, assignments, action, scope, context)) {
        return { kind: 'none' };
      }

      if (permissions.kind(action) === 'class') {
        return { kind: 'all' };
      }

      // Instance permission: narrow to owned OR assigned instances.
      const ids = new Set<string>();
      if (assignmentResolver) {
        const assigned = await assignmentResolver(
          subject,
          resourceType,
          context,
        );
        for (const id of assigned) ids.add(id);
      }

      const pred = ownership ? ownership(subject, resourceType) : null;
      return instanceVisible(pred, ids, subject);
    },
  };
}
