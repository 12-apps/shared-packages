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
import {
  MEMBERSHIP_SELECT,
  type MembershipRow,
  type RbacDbClient,
  type RbacDbProvider,
} from './db';
import {
  assertOwnershipMayMove,
  holdsOwnerLink,
  lockTenantOwnership,
  readOwnership,
} from './owner-guard';
import { grantCustomRoleToMember, revokeCustomRoleFromMember } from './team-links';
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

/**
 * The team roster's write and read paths.
 *
 * Every method that can REFUSE takes an optional `locale` — the caller's
 * language, forwarded by whatever holds the request. It is optional because it
 * is not part of what the method DOES: omit it and the refusal takes the
 * default rendering of the host's `messages`, which is a single-audience
 * host's whole behaviour. The reads that answer no sentence of their own
 * (`listTenantMemberExtraRoles`, `getMemberRole`) do not take one, because a
 * parameter they never read would be a claim they do something they do not.
 *
 * The one write that can take ownership WITHOUT a removal,
 * `revokeCustomRoleFromMember`, takes the caller after it, optional for the
 * same reason: a host calling the store with nobody to name keeps the rule
 * that somebody else must remain an owner, and skips the one about who may
 * take it (`./owner-guard`).
 *
 * There is no "set the member's role" write. Roles are granted and revoked one
 * at a time; the swap that `PATCH /team/:userId` used to run unlinked the
 * member's HIGHEST role whatever else they held, so it went (FUT-2440).
 */
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
  grantCustomRoleToMember(
    tenantId: string,
    userId: string,
    roleName: string,
    locale?: string,
  ): Promise<void>;
  revokeCustomRoleFromMember(
    tenantId: string,
    userId: string,
    roleName: string,
    locale?: string,
    actor?: RbacActorTier,
  ): Promise<void>;
  setMembershipActive(
    tenantId: string,
    userId: string,
    active: boolean,
    locale?: string,
  ): Promise<void>;
  removeTenantMemberGuarded(
    tenantId: string,
    userId: string,
    actor: RbacActorTier,
    locale?: string,
  ): Promise<void>;
}

async function membershipOf(db: RbacDbClient, tenantId: string, userId: string) {
  return db.membership.findUnique({
    where: { userId_clientId: { userId, clientId: tenantId } },
    select: MEMBERSHIP_SELECT,
  });
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

/**
 * The member a removal deletes, judged inside its transaction and after the
 * ownership lock, for every removal: a host may promote a member under the
 * same lock (ADOPTING.md, rule 10), and a removal that read the member before
 * that promotion committed would delete the new owner with no rule run. Only an owner removes an owner, or the host's platform operator,
 * recognised by the DISCRIMINATOR and never by a role name; and never the
 * last owner who counts. The target takes ownership when its column names an
 * owner role or it holds a live owner link (a transfer's residue).
 */
async function removalTarget(
  ctx: TeamStoreCtx,
  tx: RbacDbClient,
  target: { tenantId: string; userId: string },
  actor: RbacActorTier,
): Promise<MembershipRow> {
  const { tenantId, userId } = target;
  const ownerRows = await lockTenantOwnership(tx, tenantId, ctx.ownerRoles);
  const member = await membershipOf(tx, tenantId, userId);
  if (!member) throw new RbacApiError(404, ctx.messages.notAMember);
  const ownership = await readOwnership(tx, tenantId, ctx.ownerRoles, ownerRows);
  if (ctx.ownerRoles.has(member.role) || holdsOwnerLink(ownership, userId)) {
    assertOwnershipMayMove(ownership, userId, actor, ctx.ownerRoles, {
      forbidden: ctx.messages.onlyOwnerRemovesOwner,
      lastOwner: ctx.messages.lastOwner,
    });
  }
  return member;
}

async function removeTenantMemberGuarded(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
  actor: RbacActorTier,
): Promise<void> {
  const db = await ctx.db();
  // The target read, the rules and both deletes share ONE transaction, so
  // what was judged is what is deleted.
  const target = await db.$transaction(async (tx) => {
    const removed = await removalTarget(ctx, tx, { tenantId, userId }, actor);
    await tx.membership.deleteMany({ where: { userId, clientId: tenantId } });
    // Clears the member's tenant-scoped grants in the SAME transaction, so a
    // removed member leaves nothing that silently re-activates on a later
    // re-invite.
    await tx.roleAssignment.deleteMany({ where: { userId, scope: tenantId } });
    return removed;
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
  const base = {
    db: config.db,
    audit: fencedAudit(config.audit),
    ownerRoles: new Set(ownerRolesOf(config)),
    customerRole: config.customerRole,
    directory: config.directory,
  };
  /**
   * The context for ONE call, with that caller's words already chosen.
   *
   * Built per call rather than once per store, which is the whole adoption:
   * this store is constructed at boot and lives for the process, so a
   * `messages` resolved here would answer every reader in the language the
   * process started with. Everything below still reads `ctx.messages` as a
   * plain value, so no store function had to learn about locales.
   */
  const ctxFor = (locale?: string): TeamStoreCtx => ({
    ...base,
    messages: messagesOf(config, locale),
  });
  const ctx = ctxFor();
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
    grantCustomRoleToMember: (tenantId, userId, roleName, locale) =>
      grantCustomRoleToMember(ctxFor(locale), tenantId, userId, roleName),
    revokeCustomRoleFromMember: (tenantId, userId, roleName, locale, actor) =>
      revokeCustomRoleFromMember(ctxFor(locale), tenantId, userId, roleName, actor),
    setMembershipActive: (tenantId, userId, active, locale) =>
      setMembershipActive(ctxFor(locale), tenantId, userId, active),
    removeTenantMemberGuarded: (tenantId, userId, actor, locale) =>
      removeTenantMemberGuarded(ctxFor(locale), tenantId, userId, actor),
  };
}
