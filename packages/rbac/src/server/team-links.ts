import { RbacApiError } from './context';
import { MEMBERSHIP_SELECT, ROLE_SELECT } from './db';
import { assertOwnershipMayMove, lockTenantOwnership, readOwnership } from './owner-guard';
import type { RbacActorTier } from './roster-policy';
import type { TeamStoreCtx } from './team-store';

/**
 * The roster's writes to the membership ↔ role join: granting or revoking ONE
 * role. Out of `./team-store` for the size gate, and because they are one
 * family: each writes `membership_roles` and nothing else. Neither unlinks a
 * role it was not asked about (FUT-2440 took out the swap that did).
 */

export async function grantCustomRoleToMember(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  roleName: string,
): Promise<void> {
  const db = await ctx.db();
  const isNewGrant = await db.$transaction(async (tx) => {
    const member = await tx.membership.findUnique({
      where: { userId_clientId: { userId, clientId: tenantId } },
      select: MEMBERSHIP_SELECT,
    });
    if (!member) throw new RbacApiError(404, ctx.messages.notAMember);
    // Only THIS tenant's own LIVE role — never a clientId-NULL template (404).
    const role = await tx.role.findFirst({
      where: { clientId: tenantId, name: roleName, archivedAt: null },
      select: ROLE_SELECT,
    });
    if (!role) throw new RbacApiError(404, ctx.messages.roleNotFound);
    // Newness from the link's own atomic affected-count (INSERT … ON CONFLICT
    // DO NOTHING), so two concurrent first-grants can't both log.
    const created = await tx.membershipRole.createMany({
      data: [{ membershipId: member.id, roleId: role.id }],
      skipDuplicates: true,
    });
    return created.count > 0;
  });
  if (isNewGrant) {
    await ctx.audit?.({
      clientId: tenantId,
      action: 'team.role_grant',
      resourceType: 'membership',
      resourceId: userId,
      after: { roleName },
    });
  }
}

/**
 * Whether revoking `roleName` takes ownership from `userId`: they hold that
 * owner link, and no link to another live owner role that would keep them one.
 */
function takesOwnership(
  linkHolders: ReadonlyMap<string, ReadonlySet<string>>,
  roleName: string,
  userId: string,
): boolean {
  if (!linkHolders.get(roleName)?.has(userId)) return false;
  return ![...linkHolders].some(([name, holders]) => name !== roleName && holders.has(userId));
}

export async function revokeCustomRoleFromMember(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  roleName: string,
  actor?: RbacActorTier,
): Promise<void> {
  const db = await ctx.db();
  const link = {
    membership: { userId, clientId: tenantId },
    role: { clientId: tenantId, name: roleName },
  };
  // Only an owner role's revoke can take ownership, so only it takes the lock
  // and runs the rules. Every other revoke is the one statement it always was.
  const removed = ctx.ownerRoles.has(roleName)
    ? await db.$transaction(async (tx) => {
        const ownerRows = await lockTenantOwnership(tx, tenantId, ctx.ownerRoles);
        const ownership = await readOwnership(tx, tenantId, ctx.ownerRoles, ownerRows);
        if (takesOwnership(ownership.linkHolders, roleName, userId)) {
          assertOwnershipMayMove(ownership, userId, actor, ctx.ownerRoles, {
            forbidden: ctx.messages.onlyOwnerRemovesOwner,
            lastOwner: ctx.messages.lastOwner,
          });
        }
        return tx.membershipRole.deleteMany({ where: link });
      })
    : await db.membershipRole.deleteMany({ where: link });
  // Only an ACTUAL revocation gets an entry — the idempotent no-op does not.
  if (removed.count > 0) {
    await ctx.audit?.({
      clientId: tenantId,
      action: 'team.role_revoke',
      resourceType: 'membership',
      resourceId: userId,
      before: { roleName },
    });
  }
}
