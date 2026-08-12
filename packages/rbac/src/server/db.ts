/**
 * The database seam (12-13) — the exact, narrow slice of a Prisma-shaped
 * client this surface reads and writes on the five models the package owns
 * (`prisma/rbac.prisma`). Structural on purpose, never generated: a real host
 * passes its Prisma client; a harness passes hand-written SQL, and the routes
 * cannot tell.
 *
 * Every argument type below is CLOSED — the union of the shapes this package's
 * own stores actually pass — so a non-Prisma implementation has a finite,
 * documented surface to satisfy instead of "all of Prisma".
 */

/** The columns every role read selects. */
export const ROLE_SELECT = {
  id: true,
  clientId: true,
  name: true,
  permissions: true,
  description: true,
  kind: true,
  locked: true,
} as const;

export interface RoleRow {
  id: string;
  clientId: string | null;
  name: string;
  /** The DB string: a JSON array of permission strings, or the literal '*'. */
  permissions: string;
  description: string | null;
  kind: string;
  locked: boolean;
}

/** The closed set of role filters the stores use. */
export interface RoleWhere {
  id?: string;
  clientId?: string | { in: string[] };
  name?: string | { in: string[]; mode?: undefined } | { contains: string; mode: 'insensitive' };
  kind?: { in: string[] };
  locked?: boolean;
  archivedAt?: null;
  OR?: readonly {
    name?: { contains: string; mode: 'insensitive' };
    description?: { contains: string; mode: 'insensitive' };
  }[];
}

export interface RoleCreateData {
  id?: string;
  clientId: string;
  name: string;
  permissions: string;
  description: string | null;
  isTemplate: boolean;
  kind?: string;
  locked?: boolean;
}

export interface RoleUpdateData {
  name?: string;
  description?: string | null;
  permissions?: string;
  kind?: string;
}

export type RoleOrderBy = { name: 'asc' | 'desc' } | { createdAt: 'asc' | 'desc' };

export interface RoleDelegate {
  findMany(args: {
    where: RoleWhere;
    orderBy?: RoleOrderBy;
    skip?: number;
    take?: number;
    select: typeof ROLE_SELECT;
  }): Promise<RoleRow[]>;
  findFirst(args: { where: RoleWhere; select: typeof ROLE_SELECT }): Promise<RoleRow | null>;
  count(args: { where: RoleWhere }): Promise<number>;
  create(args: { data: RoleCreateData; select: typeof ROLE_SELECT }): Promise<RoleRow>;
  createMany(args: {
    data: RoleCreateData[];
    skipDuplicates: boolean;
  }): Promise<{ count: number }>;
  upsert(args: {
    where: { clientId_name: { clientId: string; name: string } };
    create: RoleCreateData;
    update: RoleUpdateData;
    select: typeof ROLE_SELECT;
  }): Promise<RoleRow>;
  updateMany(args: { where: RoleWhere; data: RoleUpdateData }): Promise<{ count: number }>;
  deleteMany(args: { where: RoleWhere }): Promise<{ count: number }>;
}

/** The columns every membership read selects. */
export const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  clientId: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

export interface MembershipRow {
  id: string;
  userId: string;
  clientId: string;
  role: string;
  active: boolean;
  createdAt: Date;
}

export interface MembershipWhere {
  clientId?: string;
  userId?: string | { in: string[] };
  role?: string | { not: string } | { in: string[] };
  active?: boolean;
  AND?: readonly MembershipWhere[];
  OR?: readonly MembershipWhere[];
}

export type MembershipOrderBy =
  | { createdAt: 'asc' | 'desc' }
  | { role: 'asc' | 'desc' };

export interface MembershipDelegate {
  findUnique(args: {
    where: { userId_clientId: { userId: string; clientId: string } };
    select: typeof MEMBERSHIP_SELECT;
  }): Promise<MembershipRow | null>;
  findMany(args: {
    where: MembershipWhere;
    orderBy?: MembershipOrderBy;
    skip?: number;
    take?: number;
    select: typeof MEMBERSHIP_SELECT;
  }): Promise<MembershipRow[]>;
  count(args: { where: MembershipWhere }): Promise<number>;
  update(args: {
    where: { id: string };
    data: { role: string };
    select: typeof MEMBERSHIP_SELECT;
  }): Promise<MembershipRow>;
  updateMany(args: {
    where: { userId: string; clientId: string; role?: { notIn: string[] } };
    data: { active: boolean };
  }): Promise<{ count: number }>;
  deleteMany(args: { where: { userId: string; clientId: string } }): Promise<{ count: number }>;
}

/** The joined columns every membership-role read selects. */
export const MEMBERSHIP_ROLE_SELECT = {
  membership: { select: { userId: true, clientId: true, role: true } },
  role: { select: { id: true, name: true } },
} as const;

export interface MembershipRoleRow {
  membership: { userId: string; clientId: string; role: string };
  role: { id: string; name: string };
}

export interface MembershipRoleWhere {
  membershipId?: string;
  roleId?: string;
  membership?: { userId?: string; clientId?: string };
  role?: { clientId: string; name: string };
}

export interface MembershipRoleDelegate {
  findMany(args: {
    where: MembershipRoleWhere;
    select: typeof MEMBERSHIP_ROLE_SELECT;
  }): Promise<MembershipRoleRow[]>;
  createMany(args: {
    data: { membershipId: string; roleId: string }[];
    skipDuplicates: boolean;
  }): Promise<{ count: number }>;
  deleteMany(args: { where: MembershipRoleWhere }): Promise<{ count: number }>;
}

export const ROLE_ASSIGNMENT_SELECT = {
  userId: true,
  roleName: true,
  scope: true,
} as const;

export interface RoleAssignmentRow {
  userId: string;
  roleName: string;
  scope: string;
}

export interface RoleAssignmentWhere {
  userId?: string;
  scope?: string;
  roleName?: { in: string[] };
}

export interface RoleAssignmentDelegate {
  findMany(args: {
    where: RoleAssignmentWhere;
    select: typeof ROLE_ASSIGNMENT_SELECT;
  }): Promise<RoleAssignmentRow[]>;
  deleteMany(args: { where: { userId: string; scope: string } }): Promise<{ count: number }>;
}

export interface ResourceAssignmentWhere {
  userId: string;
  resourceType: string;
  validFrom: { lte: Date };
  OR: readonly [{ validTo: null }, { validTo: { gt: Date } }];
  clientId?: string;
}

export interface ResourceAssignmentDelegate {
  findMany(args: {
    where: ResourceAssignmentWhere;
    select: { resourceId: true };
  }): Promise<{ resourceId: string }[]>;
}

/** The model delegates — what both a live client and a transaction expose. */
export interface RbacDbClient {
  role: RoleDelegate;
  membership: MembershipDelegate;
  membershipRole: MembershipRoleDelegate;
  roleAssignment: RoleAssignmentDelegate;
  resourceAssignment: ResourceAssignmentDelegate;
}

/**
 * The full seam: delegates plus interactive transactions. Prisma's own
 * `$transaction(fn)` satisfies this structurally — its transaction client
 * carries the same delegates.
 */
export interface RbacDb extends RbacDbClient {
  $transaction<T>(fn: (tx: RbacDbClient) => Promise<T>): Promise<T>;
}

/** Deferred so hosts with an async client bootstrap can pass it directly. */
export type RbacDbProvider = () => Promise<RbacDb>;

/** Whether an error is Prisma's unique violation (P2002) — the 409 signal. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
