import type { VisibleResult } from '../core/types';

/**
 * The LIST-seam verdict plumbing (12-13) — ported verbatim from the origin host's
 * `lib/rbac/visible.ts` + `visible-query.ts`. Pure functions: how a set of
 * per-tier {@link VisibleResult}s merges into one query fragment.
 */

/** A Prisma `where` fragment produced by {@link visibleResultToWhere}. */
export type VisibleWhere = Record<string, unknown>;

/**
 * The merged LIST-seam verdict for a read surface with several permission
 * tiers (e.g. `orders:read:all` ⊃ `orders:read:assigned` ⊃ `orders:read:own`).
 */
export interface ListVisibility {
  /**
   * False when NO tier passed the RBAC gate — the caller must 403. Distinct
   * from an authorized-but-empty reach (`where === null`), which is a 200
   * with an empty page.
   */
  authorized: boolean;
  /** Prisma fragment to AND into the query; `null` = "match nothing". */
  where: VisibleWhere | null;
}

/**
 * Merge one {@link VisibleResult} per read tier into the surface's verdict.
 * Any `all` wins outright; otherwise the tiers that passed the RBAC gate are
 * OR-united, and a tier that answered `none` contributes nothing — including
 * to `authorized`.
 */
export function mergeVisibleResults(results: readonly VisibleResult[]): ListVisibility {
  if (results.some((result) => result.kind === 'all')) {
    return { authorized: true, where: {} };
  }
  const granted = results.filter((result) => result.kind !== 'none');
  if (granted.length === 0) {
    return { authorized: false, where: null };
  }
  const wheres = granted
    .map(visibleResultToWhere)
    .filter((where): where is VisibleWhere => where !== null);
  if (wheres.length === 0) {
    return { authorized: true, where: null };
  }
  if (wheres.length === 1) {
    return { authorized: true, where: wheres[0] as VisibleWhere };
  }
  // OR-union the tiers, flattening any tier that is itself an OR so the
  // fragment stays a single-level `{ OR: [...] }`.
  const flattened = wheres.flatMap((where) => {
    const or = (where as { OR?: unknown }).OR;
    return Array.isArray(or) && Object.keys(where).length === 1
      ? (or as VisibleWhere[])
      : [where];
  });
  return { authorized: true, where: { OR: flattened } };
}

/**
 * Translate a {@link VisibleResult} into a Prisma `where` fragment. A `null`
 * return is the "match nothing" signal (both `none` and an empty predicate) —
 * callers translate it to an empty result without a DB round-trip.
 */
export function visibleResultToWhere(result: VisibleResult): VisibleWhere | null {
  switch (result.kind) {
    case 'all':
      return {};
    case 'none':
      return null;
    case 'ids':
      return result.ids.length > 0 ? { id: { in: result.ids } } : null;
    case 'predicate': {
      const predicate = result.predicate as {
        ownerField?: unknown;
        subject?: unknown;
        orIds?: unknown;
      };
      // Only an owner-field predicate yields a real `where`. An unrecognised
      // predicate shape would emit a malformed Prisma `where` that could leak
      // or throw — fail closed to match-nothing instead.
      if (
        typeof predicate.ownerField !== 'string' ||
        typeof predicate.subject !== 'string'
      ) {
        return null;
      }
      const orIds = Array.isArray(predicate.orIds)
        ? predicate.orIds.filter((id): id is string => typeof id === 'string')
        : [];
      const or: Record<string, unknown>[] = [
        { [predicate.ownerField]: predicate.subject },
      ];
      if (orIds.length > 0) {
        or.push({ id: { in: orIds } });
      }
      return { OR: or };
    }
    default:
      return null;
  }
}

/**
 * AND-merge a tenant-scoped `where` with the RBAC visibility fragment.
 * `visibleWhere` may itself be an OR, so the merge nests under `AND` instead
 * of spreading; an absent/empty fragment (the class tier) leaves the scoped
 * `where` untouched.
 */
export function andVisibleWhere(
  scoped: Record<string, unknown>,
  visibleWhere: VisibleWhere | undefined,
): Record<string, unknown> {
  return visibleWhere && Object.keys(visibleWhere).length > 0
    ? { AND: [scoped, visibleWhere] }
    : scoped;
}
