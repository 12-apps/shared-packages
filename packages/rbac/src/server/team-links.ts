import { RbacApiError } from './context';
import { MEMBERSHIP_SELECT, ROLE_SELECT, type RbacDbClient } from './db';
import { assertOwnershipMayMove, lockTenantOwnership, readOwnership } from './owner-guard';
import type { RbacActorTier } from './roster-policy';
import type { TeamStoreCtx } from './team-store';

/**
 * The roster's writes to the membership ↔ role join: the base-role swap, and
 * granting or revoking one role. Out of `./team-store` for the size gate, and
 * because they are one family: each writes `membership_roles` and nothing else.
 */

/**
 * Move a membership's PRIMARY role link from `oldRoleName` to `newRoleName`
 * in the n:m join, PRESERVING every other role the member holds — only the
 * OUTGOING primary's own link is removed, so changing the primary can never
 * silently drop a separately-granted role.
 */
export async function swapPrimaryRoleLink(
  tx: RbacDbClient,
  membership: { id: string; clientId: string },
  oldRoleName: string | null,
  newRoleName: string,
): Promise<void> {
  if (oldRoleName && oldRoleName !== newRoleName) {
    // `archivedAt: null` on both lookups, like every role read that grants:
    // an archived outgoing primary has no live link worth unlinking, and an
    // archived incoming name must never gain a fresh join row.
    const old = await tx.role.findFirst({
      where: { clientId: membership.clientId, name: oldRoleName, archivedAt: null },
      select: ROLE_SELECT,
    });
    if (old) {
      await tx.membershipRole.deleteMany({
        where: { membershipId: membership.id, roleId: old.id },
      });
    }
  }
  const next = await tx.role.findFirst({
    where: { clientId: membership.clientId, name: newRoleName, archivedAt: null },
    select: ROLE_SELECT,
  });
  if (next) {
    await tx.membershipRole.createMany({
      data: [{ membershipId: membership.id, roleId: next.id }],
      skipDuplicates: true,
    });
  }
}

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
        if (ownership.linkHolders.get(roleName)?.has(userId)) {
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
