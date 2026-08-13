import type { AuthzContext, RoleAssignment, RoleDef, Scope } from './types';
import { WILDCARD, caveatsPass, expandRole, type ExpandedRole } from './roles';

/** Inline custom roles never inherit — they compose the catalog directly. */
const NO_ROLES: ReadonlyMap<string, RoleDef> = new Map();

/**
 * The expanded permission map for an assignment. An assignment carrying inline
 * `permissions` (a DB-defined custom role, FUT-146) is expanded on the spot —
 * so its permissions actually grant even though its `role` name is absent from
 * the template index. Otherwise the name resolves against the prebuilt index (the
 * fast default for the seeded templates). Returns `undefined` for an unknown name
 * with no inline permissions (contributes nothing → deny-by-default).
 */
function expandedFor(
  assignment: RoleAssignment,
  roleIndex: ReadonlyMap<string, ExpandedRole>,
): ExpandedRole | undefined {
  if (assignment.permissions !== undefined) {
    return expandRole(
      { name: assignment.role, permissions: assignment.permissions },
      NO_ROLES,
    );
  }
  return roleIndex.get(assignment.role);
}

/** Immutable context passed to the pure check functions. */
export interface CanContext {
  /** Role name -> expanded permission map (or the wildcard marker). */
  roleIndex: ReadonlyMap<string, ExpandedRole>;
  /** Scope key that satisfies any requested scope. */
  globalScope: string;
  /** Full registry list, returned when a wildcard grant is in effect. */
  allPermissions: readonly string[];
  /**
   * Walk from a scope to its parent (org -> site chains). A grant at a
   * parent scope reaches all descendants. Cycle-guarded here. Omit for a flat
   * scope model.
   */
  scopeParent?: (scope: Scope) => Scope | null;
  /**
   * Host-populated attribute bag for ABAC caveats. Defaults to `{}`. A caveat
   * that needs data absent here must deny (never silent-allow).
   */
  context?: AuthzContext;
}

/**
 * Does an assignment's scope satisfy the requested scope? True when the
 * assignment scope equals the requested scope, the global scope, or any
 * ANCESTOR of the requested scope (walking up via `scopeParent`). The walk is
 * cycle-guarded. A CHILD-scoped grant never reaches a parent/sibling.
 */
function assignmentInScope(
  assignment: RoleAssignment,
  scope: Scope,
  ctx: CanContext,
): boolean {
  if (assignment.scope === ctx.globalScope) return true;

  const seen = new Set<Scope>();
  let current: Scope | null = scope;
  while (current !== null && !seen.has(current)) {
    if (assignment.scope === current) return true;
    seen.add(current);
    current = ctx.scopeParent ? ctx.scopeParent(current) : null;
  }
  return false;
}

/**
 * Pure, synchronous permission check. Deny-by-default.
 *
 * An assignment grants `permission` iff it applies in `scope` (its scope equals
 * the requested scope, an ancestor of it, or the global scope) AND its role's
 * expanded permission map includes `permission` (or is the wildcard) AND that
 * grant's caveat entries pass against `ctx.context`. Unknown role names are
 * silently ignored (contribute nothing -> deny).
 */
export function canWith(
  assignments: readonly RoleAssignment[],
  permission: string,
  scope: Scope,
  ctx: CanContext,
): boolean {
  const context = ctx.context ?? {};
  for (const assignment of assignments) {
    if (!assignmentInScope(assignment, scope, ctx)) continue;
    const expanded = expandedFor(assignment, ctx.roleIndex);
    if (!expanded) continue;
    if (expanded === WILDCARD) return true;
    const entries = expanded.get(permission);
    if (entries && caveatsPass(entries, context)) return true;
  }
  return false;
}

/**
 * Fold one role's caveat-passing permissions into `acc`. Extracted from the
 * assignment walk so the union stays a single (non-nested) loop over the
 * expanded map — the per-role entry scan lives here.
 */
function collectRolePermissions(
  expanded: Exclude<ExpandedRole, typeof WILDCARD>,
  context: AuthzContext,
  acc: Set<string>,
): void {
  for (const [permission, entries] of expanded) {
    if (caveatsPass(entries, context)) acc.add(permission);
  }
}

/**
 * Pure, synchronous union of all permissions granted to these assignments
 * within `scope` (caveats evaluated against `ctx.context`). A wildcard grant
 * returns the full registry list.
 */
export function permissionsFor(
  assignments: readonly RoleAssignment[],
  scope: Scope,
  ctx: CanContext,
): Set<string> {
  const context = ctx.context ?? {};
  const acc = new Set<string>();
  for (const assignment of assignments) {
    if (!assignmentInScope(assignment, scope, ctx)) continue;
    const expanded = expandedFor(assignment, ctx.roleIndex);
    if (!expanded) continue;
    if (expanded === WILDCARD) return new Set(ctx.allPermissions);
    collectRolePermissions(expanded, context, acc);
  }
  return acc;
}
