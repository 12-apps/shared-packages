import {
  paginationMeta,
  type PaginationMeta,
  type RbacUserIdentity,
} from './context';
import {
  MEMBERSHIP_ROLE_SELECT,
  MEMBERSHIP_SELECT,
  type MembershipWhere,
  type RbacDbClient,
} from './db';
import type { TeamStoreCtx } from './team-store';

/**
 * The roster's READ half (12-13) — ported from future-pay's
 * `team-roster.ts` + `membership-detail.ts` + `membership-roles.ts`, over the
 * seam. Kept apart from the write half (`team-store.ts`) so both files stay
 * within the size gate, exactly as the future-pay originals were split.
 */

export interface TeamMemberRecord {
  userId: string;
  role: string;
  email: string;
  name: string | null;
  image: string | null;
  active: boolean;
  status: 'ENABLED' | 'DISABLED';
}

export interface TeamMemberDetail extends TeamMemberRecord {
  memberSince: Date;
  lastLoginAt: Date | null;
  customRoles: string[];
}

export interface TeamListQuery {
  q?: string;
  /** Unified role pill: base role OR custom role. */
  roleIn?: readonly string[];
  /** ENABLED / DISABLED. */
  statusIn?: readonly string[];
  sort?: { field: 'role' | 'createdAt'; direction: 'asc' | 'desc' };
  page: number;
  pageSize: number;
}

/** The identity slice of a roster row, defaulted for an unknown directory id. */
function identityFields(identity: RbacUserIdentity | undefined): {
  email: string;
  name: string | null;
  image: string | null;
} {
  return {
    email: identity?.email ?? '',
    name: identity?.name ?? null,
    image: identity?.image ?? null,
  };
}

async function identityByUser(
  ctx: TeamStoreCtx,
  ids: readonly string[],
): Promise<Map<string, RbacUserIdentity>> {
  if (ids.length === 0) return new Map();
  const identities = await ctx.directory.getUsers(ids);
  return new Map(identities.map((identity) => [identity.id, identity]));
}

/** Every member's ADDITIONAL role names (beyond their primary), by userId. */
export async function extraRolesOf(
  db: RbacDbClient,
  tenantId: string,
  userId?: string,
): Promise<Map<string, string[]>> {
  const rows = await db.membershipRole.findMany({
    where: { membership: userId ? { userId, clientId: tenantId } : { clientId: tenantId } },
    select: MEMBERSHIP_ROLE_SELECT,
  });
  const result = new Map<string, string[]>();
  for (const row of rows) {
    // The primary role is surfaced on its own; list only the extra grants.
    if (row.role.name === row.membership.role) continue;
    const list = result.get(row.membership.userId) ?? [];
    list.push(row.role.name);
    result.set(row.membership.userId, list);
  }
  return result;
}

/**
 * The unified role pill: a member matches on their BASE role OR a role they
 * additionally hold — via a `role_assignments` grant at the tenant scope or a
 * `membership_roles` join row.
 */
async function roleFilterCondition(
  db: RbacDbClient,
  tenantId: string,
  roleIn: readonly string[],
): Promise<MembershipWhere> {
  const [assignmentHolders, joinHolders] = await Promise.all([
    db.roleAssignment.findMany({
      where: { scope: tenantId, roleName: { in: [...roleIn] } },
      select: { userId: true, roleName: true, scope: true },
    }),
    db.membershipRole.findMany({
      where: { membership: { clientId: tenantId } },
      select: MEMBERSHIP_ROLE_SELECT,
    }),
  ]);
  const roleSet = new Set(roleIn);
  const holderIds = new Set(assignmentHolders.map((row) => row.userId));
  for (const row of joinHolders) {
    if (roleSet.has(row.role.name)) holderIds.add(row.membership.userId);
  }
  const baseMatch: MembershipWhere = { role: { in: [...roleIn] } };
  if (holderIds.size === 0) return baseMatch;
  return { OR: [baseMatch, { userId: { in: [...holderIds] } }] };
}

/** ENABLED/DISABLED pill: constrain only when exactly one state is asked. */
function statusFilterCondition(statusIn: readonly string[]): MembershipWhere | null {
  const wantEnabled = statusIn.includes('ENABLED');
  const wantDisabled = statusIn.includes('DISABLED');
  return wantEnabled !== wantDisabled ? { active: wantEnabled } : null;
}

async function buildTeamWhere(
  ctx: TeamStoreCtx,
  db: RbacDbClient,
  tenantId: string,
  query: TeamListQuery,
): Promise<MembershipWhere> {
  const conditions: MembershipWhere[] = [
    { clientId: tenantId },
    { role: { not: ctx.customerRole } },
  ];
  if (query.q) {
    // The keyword lives in the host's user directory (name/email are not this
    // package's columns); without a `searchUsers` seam it is ignored.
    const ids = (await ctx.directory.searchUsers?.(query.q)) ?? null;
    if (ids !== null) conditions.push({ userId: { in: ids } });
  }
  if (query.roleIn && query.roleIn.length > 0) {
    conditions.push(await roleFilterCondition(db, tenantId, query.roleIn));
  }
  if (query.statusIn && query.statusIn.length > 0) {
    const status = statusFilterCondition(query.statusIn);
    if (status) conditions.push(status);
  }
  return { AND: conditions };
}

export async function listTeamPage(
  ctx: TeamStoreCtx,
  tenantId: string,
  query: TeamListQuery,
): Promise<{ data: TeamMemberRecord[]; pagination: PaginationMeta }> {
  const db = await ctx.db();
  const where = await buildTeamWhere(ctx, db, tenantId, query);
  const orderBy = query.sort
    ? query.sort.field === 'role'
      ? ({ role: query.sort.direction } as const)
      : ({ createdAt: query.sort.direction } as const)
    : ({ createdAt: 'asc' } as const);
  const [rows, total] = await Promise.all([
    db.membership.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: MEMBERSHIP_SELECT,
    }),
    db.membership.count({ where }),
  ]);
  const identities = await identityByUser(ctx, rows.map((row) => row.userId));
  return {
    data: rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      ...identityFields(identities.get(row.userId)),
      active: row.active,
      status: row.active ? ('ENABLED' as const) : ('DISABLED' as const),
    })),
    pagination: paginationMeta(total, query.page, query.pageSize),
  };
}

export async function getTenantMemberDetail(
  ctx: TeamStoreCtx,
  tenantId: string,
  userId: string,
): Promise<TeamMemberDetail | null> {
  const db = await ctx.db();
  const row = await db.membership.findUnique({
    where: { userId_clientId: { userId, clientId: tenantId } },
    select: MEMBERSHIP_SELECT,
  });
  if (!row) return null;
  const [identities, extras] = await Promise.all([
    identityByUser(ctx, [userId]),
    extraRolesOf(db, tenantId, userId),
  ]);
  const identity = identities.get(userId);
  return {
    userId: row.userId,
    role: row.role,
    ...identityFields(identity),
    active: row.active,
    status: row.active ? 'ENABLED' : 'DISABLED',
    memberSince: row.createdAt,
    lastLoginAt: identity?.lastLoginAt ?? null,
    customRoles: extras.get(userId) ?? [],
  };
}
