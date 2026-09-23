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
  type RoleRow,
} from './db';
import {
  assertOwnershipMayMove,
  holdsOwnerLink,
  lockTenantOwnership,
  readOwnership,
} from './owner-guard';
import {
  grantCustomRoleToMember,
  revokeCustomRoleFromMember,
  swapPrimaryRoleLink,
} from './team-links';
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
 * The two writes that can take ownership WITHOUT a removal, `setMemberRole`
 * and `revokeCustomRoleFromMember`, take the caller after it, optional for the
 * same reason: a host calling the store with nobody to name keeps the rule
 * that somebody else must remain an owner, and skips the one about who may
 * take it (`./owner-guard`).
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
  /** Resolves to the role the row holds after the write, read back (FUT-2441). */
  setMemberRole(
    tenantId: string,
    userId: string,
    role: string,
    locale?: string,
    actor?: RbacActorTier,
  ): Promise<string>;
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

/**
 * Whether moving a base role from `from` to `to` takes an owner role away.
 *
 * A move between two owner roles keeps ownership only when `to` has a live row
 * in the tenant to link: the swap unlinks `from` and links nothing otherwise
 * (a platform-only owner role is never seeded per tenant). With no live owner
 * row at all the column alone decides, and it still names an owner.
 */
function demotesOwner(
  ctx: TeamStoreCtx,
  move: { from: string; to: string },
  ownerRows: readonly RoleRow[],
): boolean {
  if (!ctx.ownerRoles.has(move.from)) return false;
  if (!ctx.ownerRoles.has(move.to)) return true;
  return ownerRows.length > 0 && !ownerRows.some((row) => row.name === move.to);
}

/**
 * The membership a base-role write starts from, read AFTER the ownership lock.
 *
 * Every PATCH locks, not only one whose target owns: a host may promote a
 * member under the same lock (ADOPTING.md, rule 10), and a PATCH that read
 * the member before that promotion committed would demote the new owner with
 * no rule run. After the lock, the rules, what the swap unlinks and the
 * audit's `before` all come from what the lock holder committed.
 */
async function roleSetTarget(
  ctx: TeamStoreCtx,
  tx: RbacDbClient,
  target: { tenantId: string; userId: string; role: string },
  actor: RbacActorTier | undefined,
): Promise<MembershipRow> {
  const { tenantId, userId, role } = target;
  const ownerRows = await lockTenantOwnership(tx, tenantId, ctx.ownerRoles);
  const existing = await membershipOf(tx, tenantId, userId);
  if (!existing) throw new RbacApiError(404, ctx.messages.notAMember);
  if (demotesOwner(ctx, { from: existing.role, to: role }, ownerRows)) {
    const ownership = await readOwnership(tx, tenantId, ctx.ownerRoles, ownerRows);
    assertOwnershipMayMove(ownership, userId, actor, ctx.ownerRoles, {
      forbidden: ctx.messages.onlyOwnerDemotesOwner ?? ctx.messages.onlyOwnerRemovesOwner,
      lastOwner: ctx.messages.lastOwner,
    });
  }
  return existing;
}

async function setMemberRole(
  ctx: TeamStoreCtx,
  target: { tenantId: string; userId: string; role: string },
  actor: RbacActorTier | undefined,
): Promise<string> {
  const { tenantId, userId, role } = target;
  const db = await ctx.db();
  // The read, the guards, the write and the join swap share ONE transaction
  // so a concurrent role change can't slip between them.
  const { previousRole, stored } = await db.$transaction(async (tx) => {
    const existing = await roleSetTarget(ctx, tx, target, actor);
    // Captured BEFORE the write: the outgoing primary is what the join swap
    // must unlink, whatever the row object does afterwards.
    const outgoing = existing.role;
    await tx.membership.update({
      where: { id: existing.id },
      data: { role },
      select: MEMBERSHIP_SELECT,
    });
    await swapPrimaryRoleLink(tx, { id: existing.id, clientId: tenantId }, outgoing, role);
    // Read back rather than echoed: a host that derives the column from the
    // links stores something other than `role`, and the answer and the audit
    // must say what the row holds (FUT-2441).
    const after = await membershipOf(tx, tenantId, userId);
    return { previousRole: outgoing, stored: after?.role ?? role };
  });
  // A write that changed nothing is not a grant worth an audit entry.
  if (previousRole !== stored) {
    await ctx.audit?.({
      clientId: tenantId,
      action: 'team.role_set',
      resourceType: 'membership',
      resourceId: userId,
      before: { role: previousRole },
      after: { role: stored },
    });
  }
  return stored;
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
 * ownership lock, for every removal, for the reason {@link roleSetTarget}
 * gives. Only an owner removes an owner, or the host's platform operator,
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
    setMemberRole: (tenantId, userId, role, locale, actor) =>
      setMemberRole(ctxFor(locale), { tenantId, userId, role }, actor),
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
