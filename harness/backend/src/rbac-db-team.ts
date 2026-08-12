/**
 * The membership / membership-role / assignment delegates of the rbac-db
 * seam, over hand-written SQL (12-13). Same discipline as the role delegate:
 * each method translates one CLOSED argument shape.
 */
import { randomUUID } from 'node:crypto';

import type {
  MembershipDelegate,
  MembershipRoleDelegate,
  MembershipRoleWhere,
  MembershipRow,
  MembershipWhere,
  ResourceAssignmentDelegate,
  RoleAssignmentDelegate,
} from '@12-apps/rbac/server';

import { Params, stringPredicate, type SqlRunner } from './rbac-db-shared';

interface MembershipSqlRow {
  id: string;
  user_id: string;
  client_id: string;
  role: string;
  active: boolean;
  created_at: string | Date;
}

const MEMBERSHIP_COLUMNS = 'id, user_id, client_id, role, active, created_at';

const membershipRow = (row: MembershipSqlRow): MembershipRow => ({
  id: row.id,
  userId: row.user_id,
  clientId: row.client_id,
  role: row.role,
  active: row.active,
  createdAt: new Date(row.created_at),
});

/** The seam's closed role-filter shape on the membership table. */
function membershipRolePredicate(
  role: NonNullable<MembershipWhere['role']>,
  params: Params,
): string {
  if (typeof role === 'string') return `role = ${params.add(role)}`;
  if ('not' in role) return `role <> ${params.add(role.not)}`;
  if (role.in.length === 0) return 'FALSE';
  return `role IN (${role.in.map((value) => params.add(value)).join(', ')})`;
}

function membershipConditions(where: MembershipWhere, params: Params): string[] {
  const conditions: string[] = [];
  if (where.clientId !== undefined) conditions.push(`client_id = ${params.add(where.clientId)}`);
  if (where.userId !== undefined) {
    conditions.push(stringPredicate('user_id', where.userId, params));
  }
  if (where.active !== undefined) conditions.push(`active = ${params.add(where.active)}`);
  if (where.role !== undefined) conditions.push(membershipRolePredicate(where.role, params));
  for (const branch of where.AND ?? []) {
    const nested = membershipConditions(branch, params);
    if (nested.length > 0) conditions.push(`(${nested.join(' AND ')})`);
  }
  if (where.OR !== undefined) {
    const branches = where.OR.map((branch) => {
      const nested = membershipConditions(branch, params);
      return nested.length > 0 ? `(${nested.join(' AND ')})` : 'TRUE';
    });
    conditions.push(`(${branches.join(' OR ')})`);
  }
  return conditions;
}

function membershipWhereSql(where: MembershipWhere, params: Params): string {
  const conditions = membershipConditions(where, params);
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

export function membershipDelegate(sql: SqlRunner): MembershipDelegate {
  return {
    async findUnique({ where }) {
      const params = new Params();
      const { rows } = await sql.query<MembershipSqlRow>(
        `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships
         WHERE user_id = ${params.add(where.userId_clientId.userId)}
           AND client_id = ${params.add(where.userId_clientId.clientId)}`,
        params.values,
      );
      const row = rows[0];
      return row ? membershipRow(row) : null;
    },
    async findMany({ where, orderBy, skip, take }) {
      const params = new Params();
      const order = orderBy
        ? 'role' in orderBy
          ? `ORDER BY role ${orderBy.role === 'desc' ? 'DESC' : 'ASC'}`
          : `ORDER BY created_at ${orderBy.createdAt === 'desc' ? 'DESC' : 'ASC'}`
        : 'ORDER BY created_at ASC';
      const limit = take !== undefined ? `LIMIT ${params.add(take)}` : '';
      const offset = skip !== undefined ? `OFFSET ${params.add(skip)}` : '';
      const { rows } = await sql.query<MembershipSqlRow>(
        `SELECT ${MEMBERSHIP_COLUMNS} FROM memberships ${membershipWhereSql(where, params)} ${order} ${limit} ${offset}`,
        params.values,
      );
      return rows.map(membershipRow);
    },
    async count({ where }) {
      const params = new Params();
      const { rows } = await sql.query<{ count: string | number }>(
        `SELECT COUNT(*)::int AS count FROM memberships ${membershipWhereSql(where, params)}`,
        params.values,
      );
      return Number(rows[0]?.count ?? 0);
    },
    async update({ where, data }) {
      const params = new Params();
      const { rows } = await sql.query<MembershipSqlRow>(
        `UPDATE memberships SET role = ${params.add(data.role)}, updated_at = NOW()
         WHERE id = ${params.add(where.id)}
         RETURNING ${MEMBERSHIP_COLUMNS}`,
        params.values,
      );
      const row = rows[0];
      if (!row) throw new Error(`rbac harness: no membership ${where.id}`);
      return membershipRow(row);
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const conditions = [
        `user_id = ${params.add(where.userId)}`,
        `client_id = ${params.add(where.clientId)}`,
      ];
      if (where.role !== undefined && where.role.notIn.length > 0) {
        conditions.push(
          `role NOT IN (${where.role.notIn.map((value) => params.add(value)).join(', ')})`,
        );
      }
      const { affectedRows } = await sql.query(
        `UPDATE memberships SET active = ${params.add(data.active)}, updated_at = NOW()
         WHERE ${conditions.join(' AND ')}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
    async deleteMany({ where }) {
      const params = new Params();
      const { affectedRows } = await sql.query(
        `DELETE FROM memberships
         WHERE user_id = ${params.add(where.userId)} AND client_id = ${params.add(where.clientId)}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

function membershipRoleWhereSql(where: MembershipRoleWhere, params: Params): string {
  const conditions: string[] = [];
  if (where.membershipId !== undefined) {
    conditions.push(`mr.membership_id = ${params.add(where.membershipId)}`);
  }
  if (where.roleId !== undefined) conditions.push(`mr.role_id = ${params.add(where.roleId)}`);
  if (where.membership !== undefined) {
    if (where.membership.userId !== undefined) {
      conditions.push(`m.user_id = ${params.add(where.membership.userId)}`);
    }
    if (where.membership.clientId !== undefined) {
      conditions.push(`m.client_id = ${params.add(where.membership.clientId)}`);
    }
  }
  if (where.role !== undefined) {
    conditions.push(`r.client_id = ${params.add(where.role.clientId)}`);
    conditions.push(`r.name = ${params.add(where.role.name)}`);
  }
  if (conditions.length === 0) {
    // Fail CLOSED: an empty where here would match — and a deleteMany would
    // destroy — every join row in the database. The package never issues one;
    // if a new upstream query shape arrives, this fixture's job is to fail
    // loudly, not to guess (see rbac-db.ts's header).
    throw new Error('rbac harness: membership-role query with an empty where');
  }
  return conditions.join(' AND ');
}

export function membershipRoleDelegate(sql: SqlRunner): MembershipRoleDelegate {
  return {
    async findMany({ where }) {
      const params = new Params();
      const { rows } = await sql.query<{
        user_id: string;
        client_id: string;
        member_role: string;
        role_id: string;
        role_name: string;
      }>(
        `SELECT m.user_id, m.client_id, m.role AS member_role, r.id AS role_id, r.name AS role_name
         FROM membership_roles mr
         JOIN memberships m ON m.id = mr.membership_id
         JOIN roles r ON r.id = mr.role_id
         WHERE ${membershipRoleWhereSql(where, params)}`,
        params.values,
      );
      return rows.map((row) => ({
        membership: { userId: row.user_id, clientId: row.client_id, role: row.member_role },
        role: { id: row.role_id, name: row.role_name },
      }));
    },
    async createMany({ data, skipDuplicates }) {
      if (!skipDuplicates) throw new Error('rbac harness: createMany without skipDuplicates');
      let count = 0;
      for (const item of data) {
        const params = new Params();
        const { affectedRows } = await sql.query(
          `INSERT INTO membership_roles (id, membership_id, role_id)
           VALUES (${params.add(randomUUID())}, ${params.add(item.membershipId)}, ${params.add(item.roleId)})
           ON CONFLICT DO NOTHING`,
          params.values,
        );
        count += affectedRows ?? 0;
      }
      return { count };
    },
    async deleteMany({ where }) {
      const params = new Params();
      const { affectedRows } = await sql.query(
        `DELETE FROM membership_roles mr
         USING memberships m, roles r
         WHERE m.id = mr.membership_id AND r.id = mr.role_id
           AND ${membershipRoleWhereSql(where, params)}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

export function roleAssignmentDelegate(sql: SqlRunner): RoleAssignmentDelegate {
  return {
    async findMany({ where }) {
      const params = new Params();
      const conditions: string[] = [];
      if (where.userId !== undefined) conditions.push(`user_id = ${params.add(where.userId)}`);
      if (where.scope !== undefined) conditions.push(`scope = ${params.add(where.scope)}`);
      if (where.roleName !== undefined) {
        conditions.push(
          where.roleName.in.length === 0
            ? 'FALSE'
            : `role_name IN (${where.roleName.in.map((value) => params.add(value)).join(', ')})`,
        );
      }
      const { rows } = await sql.query<{ user_id: string; role_name: string; scope: string }>(
        `SELECT user_id, role_name, scope FROM role_assignments
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}`,
        params.values,
      );
      return rows.map((row) => ({
        userId: row.user_id,
        roleName: row.role_name,
        scope: row.scope,
      }));
    },
    async deleteMany({ where }) {
      const params = new Params();
      const { affectedRows } = await sql.query(
        `DELETE FROM role_assignments
         WHERE user_id = ${params.add(where.userId)} AND scope = ${params.add(where.scope)}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

export function resourceAssignmentDelegate(sql: SqlRunner): ResourceAssignmentDelegate {
  return {
    async findMany({ where }) {
      const params = new Params();
      const conditions = [
        `user_id = ${params.add(where.userId)}`,
        `resource_type = ${params.add(where.resourceType)}`,
        `valid_from <= ${params.add(where.validFrom.lte)}`,
        `(valid_to IS NULL OR valid_to > ${params.add(where.OR[1].validTo.gt)})`,
      ];
      if (where.clientId !== undefined) {
        conditions.push(`client_id = ${params.add(where.clientId)}`);
      }
      const { rows } = await sql.query<{ resource_id: string }>(
        `SELECT resource_id FROM resource_assignments WHERE ${conditions.join(' AND ')}`,
        params.values,
      );
      return rows.map((row) => ({ resourceId: row.resource_id }));
    },
  };
}
