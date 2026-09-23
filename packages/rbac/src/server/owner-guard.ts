import { RbacApiError } from './context';
import {
  MEMBERSHIP_ROLE_SELECT,
  MEMBERSHIP_SELECT,
  ROLE_SELECT,
  type RbacDbClient,
  type RoleRow,
} from './db';
import type { RbacActorTier } from './roster-policy';

/**
 * Who owns a tenant, decided INSIDE the write that could change it.
 *
 * A member holds any number of roles, so an owner role is one role among
 * several, and three roster writes can take it away: revoking it, demoting the
 * member whose base role it is, and removing the member. Each of them used to
 * count owners in one statement and write in another. Two co-owners taking it
 * from each other at the same moment both saw a second owner, both wrote, and
 * the tenant ended with none (FUT-2435).
 *
 * The rules and the write now share one transaction, and the transaction takes
 * a row lock on the tenant's owner-role rows before it reads anything it
 * decides on: every PATCH and every removal, and the revoke of an owner role.
 * A second such write waits on that lock, and then reads what the first one
 * committed. So does a host path that moves ownership under the same lock.
 */

/**
 * Take the tenant's ownership lock inside `tx`: a no-op UPDATE of every LIVE
 * owner-role row, in id order. Resolves to those rows.
 *
 * An UPDATE because it is the one row-locking statement the seam already
 * carries: a Prisma read cannot say `FOR UPDATE`. It rewrites `kind` with the
 * value it matched, so no column the package reads changes (a host's
 * `updated_at` does move). Under READ COMMITTED, Postgres' default and what a
 * Prisma interactive transaction runs at, a second UPDATE of the same row
 * waits for this transaction to end. Locking in id order means two writers
 * that lock several owner rows cannot deadlock on each other.
 *
 * Exported for a HOST path that moves ownership on its own (a transfer, a
 * platform removal): calling this inside that path's transaction serialises it
 * with the package's writes. That transaction must then call no package store
 * method, which would open a second transaction and wait on this one's lock
 * (ADOPTING.md, host wiring rule 10).
 */
export async function lockTenantOwnership(
  tx: RbacDbClient,
  tenantId: string,
  ownerRoles: Iterable<string>,
): Promise<readonly RoleRow[]> {
  const rows = await tx.role.findMany({
    where: { clientId: tenantId, name: { in: [...ownerRoles] }, archivedAt: null },
    select: ROLE_SELECT,
  });
  const ordered = [...rows].sort(byId);
  for (const row of ordered) {
    const locked = await tx.role.updateMany({
      where: { id: row.id, kind: { in: [row.kind] } },
      data: { kind: row.kind },
    });
    // A lock statement that matched nothing took no lock. It would still pass
    // every test that cannot open two connections, so it is refused here.
    if (locked.count !== 1) {
      throw new Error(`lockTenantOwnership: owner role ${row.id} matched ${locked.count} rows`);
    }
  }
  return ordered;
}

/** Code-unit order, never the locale's: every writer must lock in ONE order. */
function byId(a: RoleRow, b: RoleRow): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** What one ownership decision reads, after the lock. */
interface TenantOwnership {
  /** Per live owner-role NAME, the user ids holding a link to that row. */
  readonly linkHolders: ReadonlyMap<string, ReadonlySet<string>>;
  /** The user ids that count as an owner (see {@link readOwnership}). */
  readonly counted: ReadonlySet<string>;
}

/**
 * Who owns the tenant, read on the transaction client after the lock.
 *
 * An owner COUNTS when the membership is active, its `role` column names an
 * owner role, AND it holds a link to one of `ownerRows`. Both halves, because
 * a host that writes the column verbatim deletes only the link on a revoke,
 * and the column goes on saying owner. Counted by the column alone, that
 * member would still act as an owner and still count as the one who remains:
 * two owners could each revoke the other, then themselves, and leave nobody
 * with the owner role's permissions. On a host that derives the column from
 * the links the two halves agree.
 *
 * A tenant with no live owner-role row has no link to hold, so there the
 * column alone decides, as it did before the links existed.
 */
export async function readOwnership(
  tx: RbacDbClient,
  tenantId: string,
  ownerRoles: ReadonlySet<string>,
  ownerRows: readonly RoleRow[],
): Promise<TenantOwnership> {
  const linkHolders = new Map<string, ReadonlySet<string>>();
  for (const row of ownerRows) {
    const links = await tx.membershipRole.findMany({
      where: { roleId: row.id, membership: { clientId: tenantId } },
      select: MEMBERSHIP_ROLE_SELECT,
    });
    linkHolders.set(row.name, new Set(links.map((link) => link.membership.userId)));
  }
  const columnOwners = await tx.membership.findMany({
    where: { clientId: tenantId, role: { in: [...ownerRoles] }, active: true },
    select: MEMBERSHIP_SELECT,
  });
  const holders = new Set([...linkHolders.values()].flatMap((ids) => [...ids]));
  const counted = new Set(
    columnOwners
      .filter((member) => ownerRows.length === 0 || holders.has(member.userId))
      .map((member) => member.userId),
  );
  return { linkHolders, counted };
}

/** Whether `userId` holds a link to any live owner-role row. */
export function holdsOwnerLink(ownership: TenantOwnership, userId: string): boolean {
  return [...ownership.linkHolders.values()].some((ids) => ids.has(userId));
}

/** The two sentences a refusal answers with; the 403 depends on the route. */
interface OwnershipRefusals {
  /** 403: the caller may not take ownership from another member. */
  readonly forbidden: string;
  /** 409: nobody else would remain an owner. */
  readonly lastOwner: string;
}

/**
 * The two ownership rules, over what {@link readOwnership} read. Throws the
 * 403 or the 409; returns when the write may take ownership from `targetUserId`.
 *
 * - The CALLER is the platform operator, or counts as an owner. `caller`
 *   absent means a host calling the store with nobody to name: that caller is
 *   trusted and only the second rule runs.
 * - Somebody OTHER than the target still counts as an owner. A disabled owner,
 *   or one whose owner link is gone, is never the one who remains.
 */
export function assertOwnershipMayMove(
  ownership: TenantOwnership,
  targetUserId: string,
  caller: RbacActorTier | undefined,
  ownerRoles: ReadonlySet<string>,
  refusals: OwnershipRefusals,
): void {
  if (caller && !callerMayTakeOwnership(ownership, caller, ownerRoles)) {
    throw new RbacApiError(403, refusals.forbidden);
  }
  const remains = [...ownership.counted].some((userId) => userId !== targetUserId);
  if (!remains) throw new RbacApiError(409, refusals.lastOwner);
}

function callerMayTakeOwnership(
  ownership: TenantOwnership,
  caller: RbacActorTier,
  ownerRoles: ReadonlySet<string>,
): boolean {
  if (caller.isPlatformActor) return true;
  // A tier built before it carried an id (a host literal such as
  // `{ role: 'OWNER', isPlatformActor: false }`) is judged by its role, as it
  // always was.
  if (caller.userId === undefined) return caller.role !== null && ownerRoles.has(caller.role);
  return caller.userId !== null && ownership.counted.has(caller.userId);
}
