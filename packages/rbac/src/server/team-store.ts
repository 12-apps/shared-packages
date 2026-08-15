import {
  RbacApiError,
  fencedAudit,
  messagesOf,
  type PaginationMeta,
  type RbacAuditSink,
  type RbacMessages,
  type RbacServerConfig,
  type RbacUserDirectory,
} from './context';
import { ownerRolesOf, type RbacActorTier } from './roster-policy';
import { MEMBERSHIP_SELECT, ROLE_SELECT, type RbacDbClient, type RbacDbProvider } from './db';
import {
  extraRolesOf,
  getTenantMemberDetail,
  listTeamPage,
  type TeamListQuery,
  type TeamMemberDetail,
  type TeamMemberRecord,
} from './team-roster-read';

/**
 * The team roster store (12-13) — ported from the origin host's
 * `lib/repositories/membership.ts` + `membership-roles.ts` + the status flip
 * of `tenant-invites.ts`, over the {@link RbacDbClient} seam; the read half
 * lives in `team-roster-read.ts`. What did NOT come along: the seat/quota
 * gates (billing is the host's, answered before delegating) and the
 * accountless invite storage (the optional invites port in the config).
 */

export type { TeamListQuery, TeamMemberDetail, TeamMemberRecord };

/** What every roster operation shares — derived once from the config. */
export interface TeamStoreCtx {
  db: RbacDbProvider;
  audit: RbacAuditSink | undefined;
  messages: RbacMessages;
  ownerRoles: ReadonlySet<string>;
  /** The membership role the roster excludes, or `null` when the host has none. */
  customerRole: string | null;
  directory: RbacUserDirectory;
}

export interface TeamStore {
  listTeamPage(
    tenantId: string,
    query: TeamListQuery,
  ): Promise<{ data: TeamMemberRecord[]; pagination: PaginationMeta }>;
  getTenantMemberDetail(tenantId: string, userId: string): Promise<TeamMemberDetail | null>;
  /** Every member's ADDITIONAL role names (beyond their primary), by userId. */
  listTenantMemberExtraRoles(tenantId: string): Promise<Map<string, string[]>>;
  /** The actor's own base role at the tenant, or null (not a member). */
  getMemberRole(tenantId: string, userId: string): Promise<string | null>;
  setMemberRole(tenantId: string, userId: string, role: string): Promise<void>;
  grantCustomRoleToMember(tenantId: string, userId: string, roleName: string): Promise<void>;
  revokeCustomRoleFromMember(tenantId: string, userId: string, roleName: string): Promise<void>;
  setMembershipActive(tenantId: string, userId: string, active: boolean): Promise<void>;
  removeTenantMemberGuarded(
    tenantId: string,
    userId: string,
    actor: RbacActorTier,
  ): Promise<void>;
}

/**
 * Move a membership's PRIMARY role link from `oldRoleName` to `newRoleName`
 * in the n:m join, PRESERVING every other role the member holds — only the
 * OUTGOING primary's own link is removed, so changing the primary can never
 * silently drop a separately-granted role.
 */
async function swapPrimaryRoleLink(
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

async function membershipOf(db: RbacDbClient, tenantId: string, userId: string) {
  return db.membership.findUnique({
    where: { userId_clientId: { userId, clientId: tenantId } },
    select: MEMBERSHIP_SELECT,
  });
}

async function setMemberRole(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  role: string,
): Promise<void> {
  const db = await ctx.db();
  // The read, the guards, the write and the join swap share ONE transaction
  // so a concurrent role change can't slip between them.
  const previousRole = await db.$transaction(async (tx) => {
    const existing = await tx.membership.findUnique({
      where: { userId_clientId: { userId, clientId: tenantId } },
      select: MEMBERSHIP_SELECT,
    });
    if (!existing) throw new RbacApiError(404, ctx.messages.notAMember);
    // Captured BEFORE the write: the outgoing primary is what the join swap
    // must unlink, whatever the row object does afterwards.
    const outgoing = existing.role;
    // Never demote the tenant's last OWNER.
    if (ctx.ownerRoles.has(outgoing) && !ctx.ownerRoles.has(role)) {
      const owners = await tx.membership.count({
        where: { clientId: tenantId, role: { in: [...ctx.ownerRoles] } },
      });
      if (owners <= 1) throw new RbacApiError(409, ctx.messages.lastOwner);
    }
    await tx.membership.update({
      where: { id: existing.id },
      data: { role },
      select: MEMBERSHIP_SELECT,
    });
    await swapPrimaryRoleLink(tx, { id: existing.id, clientId: tenantId }, outgoing, role);
    return outgoing;
  });
  // A no-op re-set (same role) is not a grant worth an audit entry.
  if (previousRole !== role) {
    await ctx.audit?.({
      clientId: tenantId,
      action: 'team.role_set',
      resourceType: 'membership',
      resourceId: userId,
      before: { role: previousRole },
      after: { role },
    });
  }
}

async function grantCustomRoleToMember(
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

async function revokeCustomRoleFromMember(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  roleName: string,
): Promise<void> {
  const db = await ctx.db();
  const removed = await db.membershipRole.deleteMany({
    where: {
      membership: { userId, clientId: tenantId },
      role: { clientId: tenantId, name: roleName },
    },
  });
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

async function setMembershipActive(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  active: boolean,
): Promise<void> {
  const db = await ctx.db();
  const membership = await membershipOf(db, tenantId, userId);
  if (!membership) throw new RbacApiError(404, ctx.messages.notAMember);
  if (!active && ctx.ownerRoles.has(membership.role)) {
    throw new RbacApiError(403, ctx.messages.ownerNotDisableable);
  }
  // Owner-protection is ALSO enforced atomically in the write predicate: a
  // disable only matches a NON-owner row, so a concurrent promotion to OWNER
  // makes the update match nothing (TOCTOU-safe).
  const where = active
    ? { userId, clientId: tenantId }
    : { userId, clientId: tenantId, role: { notIn: [...ctx.ownerRoles] } };
  const result = await db.membership.updateMany({ where, data: { active } });
  if (result.count === 0 && !active) {
    throw new RbacApiError(403, ctx.messages.ownerNotDisableable);
  }
  if (result.count > 0 && membership.active !== active) {
    await ctx.audit?.({
      clientId: tenantId,
      action: 'team.member_status',
      resourceType: 'membership',
      resourceId: userId,
      before: { active: membership.active },
      after: { active },
    });
  }
}

async function removeTenantMemberGuarded(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  actor: RbacActorTier,
): Promise<void> {
  const db = await ctx.db();
  const target = await membershipOf(db, tenantId, userId);
  if (!target) throw new RbacApiError(404, ctx.messages.notAMember);

  if (ctx.ownerRoles.has(target.role)) {
    // Only an owner removes an owner — or the host's platform operator, who is
    // recognized by the DISCRIMINATOR and never by a role name. Comparing
    // against the literal `'SUPERADMIN'` here read a host's own vocabulary as
    // a platform grant.
    const actorIsOwner = actor.role !== null && ctx.ownerRoles.has(actor.role);
    if (!actorIsOwner && !actor.isPlatformActor) {
      throw new RbacApiError(403, ctx.messages.onlyOwnerRemovesOwner);
    }
    const owners = await db.membership.count({
      where: { clientId: tenantId, role: { in: [...ctx.ownerRoles] } },
    });
    if (owners <= 1) throw new RbacApiError(409, ctx.messages.lastOwner);
  }

  await db.$transaction(async (tx) => {
    await tx.membership.deleteMany({ where: { userId, clientId: tenantId } });
    // Clears the member's tenant-scoped grants in the SAME transaction, so a
    // removed member leaves nothing that silently re-activates on a later
    // re-invite.
    await tx.roleAssignment.deleteMany({ where: { userId, scope: tenantId } });
  });
  await ctx.audit?.({
    clientId: tenantId,
    action: 'team.member_remove',
    resourceType: 'membership',
    resourceId: userId,
    before: { role: target.role },
  });
}

/**
 * `catalog` is IN the pick, and that is the point of this shape.
 *
 * Without it the store could not see `catalog.governance.ownerRoles` and fell
 * back to the literal `['OWNER']` — so a host whose composed governance said
 * `['OWNER', 'SUPERADMIN']` had the last-owner and owner-removal invariants
 * running on a set its own catalog did not name. The screen and the endpoints
 * were governed by different policies, which is exactly what one `catalog`
 * argument exists to prevent.
 */
type TeamStoreConfig<P extends string> = Pick<
  RbacServerConfig<P>,
  'db' | 'audit' | 'messages' | 'directory' | 'catalog' | 'ownerRoles' | 'customerRole'
>;

export function createTeamStore<P extends string>(config: TeamStoreConfig<P>): TeamStore {
  const ctx: TeamStoreCtx = {
    db: config.db,
    audit: fencedAudit(config.audit),
    messages: messagesOf(config),
    ownerRoles: new Set(ownerRolesOf(config)),
    customerRole: config.customerRole,
    directory: config.directory,
  };
  return {
    listTeamPage: (tenantId, query) => listTeamPage(ctx, tenantId, query),
    getTenantMemberDetail: (tenantId, userId) => getTenantMemberDetail(ctx, tenantId, userId),
    listTenantMemberExtraRoles: async (tenantId) => extraRolesOf(await ctx.db(), tenantId),
    getMemberRole: async (tenantId, userId) => {
      const row = await membershipOf(await ctx.db(), tenantId, userId);
      // The TIER reader: a soft-disabled membership grants NOTHING —
      // "Desativar" is the reversible revocation, and the roster tier is
      // exactly the kind of access it must revoke (the origin host's
      // `membershipTier` refuses a disabled row the same way). The WRITE
      // paths deliberately keep seeing the disabled row: `setMembershipActive`
      // re-enables it and `removeTenantMemberGuarded` deletes it.
      if (!row || !row.active) return null;
      return row.role;
    },
    setMemberRole: (tenantId, userId, role) => setMemberRole(ctx, tenantId, userId, role),
    grantCustomRoleToMember: (tenantId, userId, roleName) =>
      grantCustomRoleToMember(ctx, tenantId, userId, roleName),
    revokeCustomRoleFromMember: (tenantId, userId, roleName) =>
      revokeCustomRoleFromMember(ctx, tenantId, userId, roleName),
    setMembershipActive: (tenantId, userId, active) =>
      setMembershipActive(ctx, tenantId, userId, active),
    removeTenantMemberGuarded: (tenantId, userId, actor) =>
      removeTenantMemberGuarded(ctx, tenantId, userId, actor),
  };
}
