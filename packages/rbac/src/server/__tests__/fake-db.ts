import type {
  MembershipRow,
  MembershipRoleWhere,
  MembershipWhere,
  RbacDb,
  RbacDbClient,
  ResourceAssignmentWhere,
  RoleAssignmentWhere,
  RoleRow,
  RoleWhere,
} from '../db';

/**
 * An in-memory implementation of the {@link RbacDb} seam, interpreting the
 * CLOSED set of argument shapes the stores actually pass. Deliberately not
 * Prisma: the seam is structural, and this fake is the unit-test proof that a
 * non-Prisma host can satisfy it (the harness proves the same over real SQL).
 */

interface RoleRecord extends RoleRow {
  isTemplate: boolean;
  archivedAt: Date | null;
  createdAt: Date;
}

type MembershipRecord = MembershipRow;

interface MembershipRoleRecord {
  id: string;
  membershipId: string;
  roleId: string;
}

interface RoleAssignmentRecord {
  id: string;
  userId: string;
  roleName: string;
  scope: string;
}

interface ResourceAssignmentRecord {
  id: string;
  userId: string;
  clientId: string;
  resourceType: string;
  resourceId: string;
  validFrom: Date;
  validTo: Date | null;
}

export interface FakeRbacState {
  roles: RoleRecord[];
  memberships: MembershipRecord[];
  membershipRoles: MembershipRoleRecord[];
  roleAssignments: RoleAssignmentRecord[];
  resourceAssignments: ResourceAssignmentRecord[];
}

// A container property, not a reassigned binding, and a FIXED epoch instead
// of the wall clock — the flakiness gate's rules, and the right ones for a
// deterministic fixture.
const counter = { next: 0, tick: 0 };
const id = (): string => `fake-${(counter.next += 1)}`;
const BASE_TIME = Date.UTC(2026, 0, 1);
const nextTimestamp = (): Date => new Date(BASE_TIME + (counter.tick += 1) * 1000);

function matchString(
  value: string | null,
  filter:
    | string
    | { in: string[] }
    | { contains: string; mode: 'insensitive' }
    | undefined,
): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return value === filter;
  if ('in' in filter) return value !== null && filter.in.includes(value);
  return value !== null && value.toLowerCase().includes(filter.contains.toLowerCase());
}

function matchRole(row: RoleRecord, where: RoleWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (!matchString(row.clientId, where.clientId)) return false;
  if (!matchString(row.name, where.name)) return false;
  if (where.kind !== undefined && !where.kind.in.includes(row.kind)) return false;
  if (where.locked !== undefined && row.locked !== where.locked) return false;
  if (where.archivedAt === null && row.archivedAt !== null) return false;
  if (where.OR) {
    const any = where.OR.some(
      (branch) =>
        (branch.name !== undefined && matchString(row.name, branch.name)) ||
        (branch.description !== undefined &&
          matchString(row.description, branch.description)),
    );
    if (!any) return false;
  }
  return true;
}

function matchMembership(row: MembershipRecord, where: MembershipWhere): boolean {
  if (where.clientId !== undefined && row.clientId !== where.clientId) return false;
  if (where.userId !== undefined && !matchString(row.userId, where.userId)) return false;
  if (where.active !== undefined && row.active !== where.active) return false;
  if (where.role !== undefined) {
    if (typeof where.role === 'string') {
      if (row.role !== where.role) return false;
    } else if ('not' in where.role) {
      if (row.role === where.role.not) return false;
    } else if (!where.role.in.includes(row.role)) return false;
  }
  if (where.AND && !where.AND.every((branch) => matchMembership(row, branch))) return false;
  if (where.OR && !where.OR.some((branch) => matchMembership(row, branch))) return false;
  return true;
}

export function createFakeRbacDb(): { db: RbacDb; state: FakeRbacState } {
  const state: FakeRbacState = {
    roles: [],
    memberships: [],
    membershipRoles: [],
    roleAssignments: [],
    resourceAssignments: [],
  };

  const roleView = (row: RoleRecord): RoleRow => ({
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    permissions: row.permissions,
    description: row.description,
    kind: row.kind,
    locked: row.locked,
  });

  const membershipRoleMatches = (row: MembershipRoleRecord, where: MembershipRoleWhere) => {
    if (where.membershipId !== undefined && row.membershipId !== where.membershipId) {
      return false;
    }
    if (where.roleId !== undefined && row.roleId !== where.roleId) return false;
    const membership = state.memberships.find((m) => m.id === row.membershipId);
    const role = state.roles.find((r) => r.id === row.roleId);
    if (where.membership) {
      if (!membership) return false;
      if (
        where.membership.userId !== undefined &&
        membership.userId !== where.membership.userId
      ) {
        return false;
      }
      if (
        where.membership.clientId !== undefined &&
        membership.clientId !== where.membership.clientId
      ) {
        return false;
      }
    }
    if (where.role) {
      if (!role) return false;
      if (role.clientId !== where.role.clientId || role.name !== where.role.name) {
        return false;
      }
    }
    return true;
  };

  const client: RbacDbClient = {
    role: {
      async findMany({ where, orderBy, skip, take }) {
        const matched = state.roles.filter((row) => matchRole(row, where));
        const [field, direction] = orderBy
          ? (Object.entries(orderBy)[0] as ['name' | 'createdAt', 'asc' | 'desc'])
          : ['name', 'asc' as const];
        const sorted = [...matched].sort((a, b) => {
          const left = field === 'name' ? a.name : a.createdAt.toISOString();
          const right = field === 'name' ? b.name : b.createdAt.toISOString();
          return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
        });
        const paged = sorted.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take);
        return paged.map(roleView);
      },
      async findFirst({ where }) {
        const row = state.roles.find((candidate) => matchRole(candidate, where));
        return row ? roleView(row) : null;
      },
      async count({ where }) {
        return state.roles.filter((row) => matchRole(row, where)).length;
      },
      async create({ data }) {
        const duplicate = state.roles.some(
          (row) => row.clientId === data.clientId && row.name === data.name,
        );
        if (duplicate) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row: RoleRecord = {
          id: data.id ?? id(),
          clientId: data.clientId,
          name: data.name,
          permissions: data.permissions,
          description: data.description,
          isTemplate: data.isTemplate,
          kind: data.kind ?? 'CUSTOM',
          locked: data.locked ?? false,
          archivedAt: null,
          createdAt: nextTimestamp(),
        };
        state.roles.push(row);
        return roleView(row);
      },
      async createMany({ data, skipDuplicates }) {
        const created: string[] = [];
        for (const item of data) {
          const duplicate = state.roles.some(
            (row) =>
              row.id === item.id ||
              (row.clientId === item.clientId && row.name === item.name),
          );
          if (duplicate) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          const rowId = item.id ?? id();
          state.roles.push({
            id: rowId,
            clientId: item.clientId,
            name: item.name,
            permissions: item.permissions,
            description: item.description,
            isTemplate: item.isTemplate,
            kind: item.kind ?? 'CUSTOM',
            locked: item.locked ?? false,
            archivedAt: null,
            createdAt: nextTimestamp(),
          });
          created.push(rowId);
        }
        return { count: created.length };
      },
      async upsert({ where, create, update }) {
        const existing = state.roles.find(
          (row) =>
            row.clientId === where.clientId_name.clientId &&
            row.name === where.clientId_name.name,
        );
        if (existing) {
          if (update.name !== undefined) existing.name = update.name;
          if (update.description !== undefined) existing.description = update.description;
          if (update.permissions !== undefined) existing.permissions = update.permissions;
          if (update.kind !== undefined) existing.kind = update.kind;
          return roleView(existing);
        }
        return this.create({ data: create, select: undefined as never });
      },
      async updateMany({ where, data }) {
        const rows = state.roles.filter((row) => matchRole(row, where));
        for (const row of rows) {
          if (data.name !== undefined) row.name = data.name;
          if (data.description !== undefined) row.description = data.description;
          if (data.permissions !== undefined) row.permissions = data.permissions;
          if (data.kind !== undefined) row.kind = data.kind;
          if (data.archivedAt !== undefined) row.archivedAt = data.archivedAt;
        }
        return { count: rows.length };
      },
      async deleteMany({ where }) {
        const doomed = state.roles.filter((row) => matchRole(row, where));
        state.roles = state.roles.filter((row) => !doomed.includes(row));
        // The FK cascade: a deleted role takes its assignments with it.
        state.membershipRoles = state.membershipRoles.filter(
          (link) => !doomed.some((row) => row.id === link.roleId),
        );
        return { count: doomed.length };
      },
    },
    membership: {
      async findUnique({ where }) {
        const row = state.memberships.find(
          (candidate) =>
            candidate.userId === where.userId_clientId.userId &&
            candidate.clientId === where.userId_clientId.clientId,
        );
        // A detached copy, as Prisma answers — a caller must never observe its
        // own later writes through an earlier read.
        return row ? { ...row } : null;
      },
      async findMany({ where, orderBy, skip, take }) {
        const matched = state.memberships.filter((row) => matchMembership(row, where));
        const [field, direction] = orderBy
          ? (Object.entries(orderBy)[0] as ['role' | 'createdAt', 'asc' | 'desc'])
          : ['createdAt', 'asc' as const];
        const sorted = [...matched].sort((a, b) => {
          const left = field === 'role' ? a.role : a.createdAt.toISOString();
          const right = field === 'role' ? b.role : b.createdAt.toISOString();
          return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
        });
        const paged = sorted.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take);
        return paged.map((row) => ({ ...row }));
      },
      async count({ where }) {
        return state.memberships.filter((row) => matchMembership(row, where)).length;
      },
      async update({ where, data }) {
        const row = state.memberships.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error(`No membership ${where.id}`);
        row.role = data.role;
        return { ...row };
      },
      async updateMany({ where, data }) {
        const rows = state.memberships.filter((row) => {
          if (row.userId !== where.userId || row.clientId !== where.clientId) return false;
          if (where.role && where.role.notIn.includes(row.role)) return false;
          return true;
        });
        for (const row of rows) row.active = data.active;
        return { count: rows.length };
      },
      async deleteMany({ where }) {
        const doomed = state.memberships.filter(
          (row) => row.userId === where.userId && row.clientId === where.clientId,
        );
        state.memberships = state.memberships.filter((row) => !doomed.includes(row));
        state.membershipRoles = state.membershipRoles.filter(
          (link) => !doomed.some((row) => row.id === link.membershipId),
        );
        return { count: doomed.length };
      },
    },
    membershipRole: {
      async findMany({ where }) {
        return state.membershipRoles
          .filter((row) => membershipRoleMatches(row, where))
          .flatMap((row) => {
            const membership = state.memberships.find((m) => m.id === row.membershipId);
            const role = state.roles.find((r) => r.id === row.roleId);
            if (!membership || !role) return [];
            return [
              {
                membership: {
                  userId: membership.userId,
                  clientId: membership.clientId,
                  role: membership.role,
                },
                role: { id: role.id, name: role.name },
              },
            ];
          });
      },
      async createMany({ data, skipDuplicates }) {
        const created: string[] = [];
        for (const item of data) {
          const duplicate = state.membershipRoles.some(
            (row) =>
              row.membershipId === item.membershipId && row.roleId === item.roleId,
          );
          if (duplicate) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          const rowId = id();
          state.membershipRoles.push({ id: rowId, ...item });
          created.push(rowId);
        }
        return { count: created.length };
      },
      async deleteMany({ where }) {
        const doomed = state.membershipRoles.filter((row) =>
          membershipRoleMatches(row, where),
        );
        state.membershipRoles = state.membershipRoles.filter((row) => !doomed.includes(row));
        return { count: doomed.length };
      },
    },
    roleAssignment: {
      async findMany({ where }: { where: RoleAssignmentWhere; select: unknown }) {
        return state.roleAssignments
          .filter((row) => {
            if (where.userId !== undefined && row.userId !== where.userId) return false;
            if (where.scope !== undefined && row.scope !== where.scope) return false;
            if (where.roleName !== undefined && !where.roleName.in.includes(row.roleName)) {
              return false;
            }
            return true;
          })
          .map((row) => ({ userId: row.userId, roleName: row.roleName, scope: row.scope }));
      },
      async deleteMany({ where }) {
        const doomed = state.roleAssignments.filter(
          (row) => row.userId === where.userId && row.scope === where.scope,
        );
        state.roleAssignments = state.roleAssignments.filter((row) => !doomed.includes(row));
        return { count: doomed.length };
      },
    },
    resourceAssignment: {
      async findMany({ where }: { where: ResourceAssignmentWhere; select: unknown }) {
        return state.resourceAssignments
          .filter((row) => {
            if (row.userId !== where.userId) return false;
            if (row.resourceType !== where.resourceType) return false;
            if (where.clientId !== undefined && row.clientId !== where.clientId) return false;
            if (row.validFrom > where.validFrom.lte) return false;
            const [, gt] = where.OR;
            if (row.validTo !== null && row.validTo <= gt.validTo.gt) return false;
            return true;
          })
          .map((row) => ({ resourceId: row.resourceId }));
      },
    },
  };

  const db: RbacDb = {
    ...client,
    // No isolation in a fake — the transaction is the same client, which is
    // exactly what the stores may assume of the seam (Prisma's is stronger).
    $transaction: async (fn) => fn(client),
  };

  return { db, state };
}

/** Test helper: seed a tenant custom role row directly. */
export function seedRole(
  state: FakeRbacState,
  input: {
    clientId: string | null;
    name: string;
    permissions: readonly string[] | '*';
    kind?: string;
    locked?: boolean;
    archivedAt?: Date | null;
  },
): string {
  const rowId = id();
  state.roles.push({
    id: rowId,
    clientId: input.clientId,
    name: input.name,
    permissions: input.permissions === '*' ? '*' : JSON.stringify(input.permissions),
    description: null,
    isTemplate: false,
    kind: input.kind ?? 'CUSTOM',
    locked: input.locked ?? false,
    archivedAt: input.archivedAt ?? null,
    createdAt: nextTimestamp(),
  });
  return rowId;
}

/** Test helper: enrol a member with a base role, wiring the n:m join. */
export function enrolMember(
  state: FakeRbacState,
  clientId: string,
  userId: string,
  roleName: string,
  opts: { active?: boolean } = {},
): string {
  const membershipId = id();
  state.memberships.push({
    id: membershipId,
    userId,
    clientId,
    role: roleName,
    active: opts.active ?? true,
    createdAt: nextTimestamp(),
  });
  const role = state.roles.find((row) => row.clientId === clientId && row.name === roleName);
  if (role) {
    state.membershipRoles.push({ id: id(), membershipId, roleId: role.id });
  }
  return membershipId;
}

/** Test helper: grant a role name at a scope via a RoleAssignment row. */
export function assignRole(
  state: FakeRbacState,
  userId: string,
  roleName: string,
  scope: string,
): void {
  state.roleAssignments.push({ id: id(), userId, roleName, scope });
}
