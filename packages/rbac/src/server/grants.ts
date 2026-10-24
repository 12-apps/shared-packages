import type { RoleAssignment } from '../core/types';

/**
 * A subject's GRANTS, loaded together: the role assignments every decision
 * reads, and the resource assignments every reach question reads.
 *
 * The engine asks for them on every `can`, `requirePermission`,
 * `visibleResources` and `getPermissions`, and a list guard asks once per read
 * tier. Read from the database each time, one guarded request re-read the same
 * person's memberships, roles and assignments several times over (FUT-3906:
 * 27 statements for the garçom's close, 133 of the 222 a floor re-read issues).
 * {@link RbacGrantsPort} lets the host keep them — resolved once, at sign-in,
 * and invalidated when any of them changes — so a decision reads none.
 */
export interface RbacSubjectGrants {
  /** The role assignments the engine decides with. */
  readonly assignments: readonly RoleAssignment[];
  /**
   * Every resource assignment of the subject that has not ENDED when it was
   * loaded, with its window. A window opening later is kept: the reach
   * question filters by the moment it is asked, not by the moment of the load.
   */
  readonly resources: readonly RbacResourceGrant[];
}

/** One resource assignment, as the reach question filters it. */
export interface RbacResourceGrant {
  readonly resourceType: string;
  readonly resourceId: string;
  /** The tenant it was granted at; `null` for an assignment with no tenant. */
  readonly clientId: string | null;
  /** ISO instants, so a stored snapshot round-trips through JSON unchanged. */
  readonly validFrom: string;
  readonly validTo: string | null;
}

/**
 * Where a subject's grants come from, when the host keeps them.
 *
 * `get` answers from the host's store, or calls `load` — the package's own
 * batched read of the tables it owns — when the store holds nothing current
 * for the subject, and keeps what it returns. Deciding what "current" means is
 * the host's: the host owns the store, and so it owns invalidation. Without
 * this port the engine loads on every question, as it always has.
 */
export interface RbacGrantsPort {
  get(subject: string, load: () => Promise<RbacSubjectGrants>): Promise<RbacSubjectGrants>;
}

/** `RbacServerConfig.grants`, apart so the config stays within its size gate. */
export interface RbacGrantsOption {
  /**
   * Where a subject's grants come from, when the host keeps them (FUT-3906).
   * Absent, every decision reads them from the database. Present, the engine
   * asks the port, and the host decides when its copy is no longer current.
   */
  grants?: RbacGrantsPort;
}

/**
 * The ids a subject holds for `resourceType` at `now`, narrowed to a tenant
 * when the decision is tenant-scoped — the same answer the database read
 * gives, computed from loaded grants.
 */
export function activeResourceIds(
  grants: RbacSubjectGrants,
  resourceType: string,
  tenantFilter: { clientId?: string },
  now: Date,
): string[] {
  const at = now.getTime();
  return grants.resources
    .filter(
      (grant) =>
        grant.resourceType === resourceType &&
        (tenantFilter.clientId === undefined || grant.clientId === tenantFilter.clientId) &&
        Date.parse(grant.validFrom) <= at &&
        (grant.validTo === null || Date.parse(grant.validTo) > at),
    )
    .map((grant) => grant.resourceId);
}

/**
 * When a loaded set of grants next changes ON ITS OWN: the earliest window
 * start or end still ahead of `now`, or `null` when none is. A host keeping
 * grants must not keep them past this instant without reloading — a
 * time-bounded assignment opens and closes with no write to invalidate on.
 */
export function nextGrantBoundary(grants: RbacSubjectGrants, now: Date): Date | null {
  const at = now.getTime();
  const ahead = grants.resources
    .flatMap((grant) => (grant.validTo === null ? [grant.validFrom] : [grant.validFrom, grant.validTo]))
    .map((instant) => Date.parse(instant))
    .filter((time) => time > at);
  return ahead.length === 0 ? null : new Date(Math.min(...ahead));
}
