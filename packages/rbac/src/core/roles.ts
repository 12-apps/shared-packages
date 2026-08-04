import type { AuthzContext, Caveat, RoleDef } from './types';

/**
 * Marker returned by {@link expandRole} for a role that grants everything
 * (`permissions: '*'`, directly or via inheritance).
 */
export const WILDCARD = '*' as const;
export type Wildcard = typeof WILDCARD;

/**
 * Per-permission caveat requirement. For a granted permission we collect every
 * way it was granted:
 *
 * - `null`  — granted with NO caveat (unconditional). One such entry makes the
 *   permission hold regardless of context.
 * - `Caveat` — granted only if this predicate passes against the context.
 *
 * A permission is satisfied iff ANY of its entries is satisfied (an OR): an
 * unconditional grant, or at least one passing caveat.
 */
export type CaveatEntry = Caveat | null;

/**
 * An expanded role is either the full permission set (wildcard) or a map from
 * permission -> the list of ways it was granted (its caveat entries).
 */
export type ExpandedRole = Map<string, CaveatEntry[]> | Wildcard;

/**
 * Resolve a role's effective permissions, following `inherits` recursively.
 *
 * - Cycle-guarded: a role that (transitively) inherits itself will not loop.
 * - Wildcard short-circuits: if the role or anything it inherits is `'*'`, the
 *   result is the {@link WILDCARD} marker (no map materialised).
 * - Caveats are preserved per grant; a bare permission entry records `null`.
 */
export function expandRole(
  role: RoleDef,
  allRoles: ReadonlyMap<string, RoleDef>,
): ExpandedRole {
  const acc = new Map<string, CaveatEntry[]>();
  const visited = new Set<string>();

  const add = (permission: string, caveat: CaveatEntry): void => {
    const entries = acc.get(permission);
    if (entries) entries.push(caveat);
    else acc.set(permission, [caveat]);
  };

  const walk = (current: RoleDef): boolean => {
    if (visited.has(current.name)) return false;
    visited.add(current.name);

    if (current.permissions === '*') return true;
    for (const entry of current.permissions) {
      if (typeof entry === 'string') add(entry, null);
      else add(entry.permission, entry.caveat ?? null);
    }

    for (const parentName of current.inherits ?? []) {
      const parent = allRoles.get(parentName);
      // Unknown inherited role names are ignored (deny-by-default posture).
      if (parent && walk(parent)) return true;
    }
    return false;
  };

  if (walk(role)) return WILDCARD;
  return acc;
}

/**
 * Build the role index consumed by the pure `can` layer: role name -> expanded
 * permission map (or the wildcard marker). Computed once per engine build.
 */
export function buildRoleIndex(
  roles: readonly RoleDef[],
): Map<string, ExpandedRole> {
  const byName = new Map<string, RoleDef>();
  for (const r of roles) byName.set(r.name, r);

  const index = new Map<string, ExpandedRole>();
  for (const r of roles) index.set(r.name, expandRole(r, byName));
  return index;
}

/**
 * Evaluate whether a permission's caveat entries are satisfied by the context.
 * OR semantics: an unconditional (`null`) entry always passes; otherwise at
 * least one caveat predicate must pass. Missing context is `{}` — a caveat that
 * needs data it cannot find must return `false` (deny, never silent allow).
 */
export function caveatsPass(
  entries: readonly CaveatEntry[],
  context: AuthzContext,
): boolean {
  for (const entry of entries) {
    if (entry === null) return true;
    if (entry(context)) return true;
  }
  return false;
}
