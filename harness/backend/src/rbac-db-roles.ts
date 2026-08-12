/**
 * The `role` delegate of the rbac-db seam, over hand-written SQL (12-13).
 * Each method translates one CLOSED argument shape the package documents in
 * its `db.ts`; anything outside those shapes throws rather than guessing.
 */
import { randomUUID } from 'node:crypto';

import type { RoleCreateData, RoleDelegate, RoleRow, RoleUpdateData, RoleWhere } from '@12-apps/rbac/server';

import { Params, rethrowUnique, stringPredicate, type SqlRunner } from './rbac-db-shared';

export function roleWhereSql(where: RoleWhere, params: Params): string {
  const conditions: string[] = [];
  if (where.id !== undefined) conditions.push(`id = ${params.add(where.id)}`);
  if (where.clientId !== undefined) {
    conditions.push(stringPredicate('client_id', where.clientId, params));
  }
  if (where.name !== undefined) {
    conditions.push(stringPredicate('name', where.name, params));
  }
  if (where.kind !== undefined) {
    conditions.push(stringPredicate('kind', where.kind, params));
  }
  if (where.locked !== undefined) conditions.push(`locked = ${params.add(where.locked)}`);
  if (where.archivedAt === null) conditions.push('archived_at IS NULL');
  if (where.OR !== undefined) {
    const branches = where.OR.map((branch) => {
      const parts: string[] = [];
      if (branch.name !== undefined) {
        parts.push(stringPredicate('name', branch.name, params));
      }
      if (branch.description !== undefined) {
        parts.push(stringPredicate('description', branch.description, params));
      }
      return `(${parts.join(' AND ')})`;
    });
    conditions.push(`(${branches.join(' OR ')})`);
  }
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

interface RoleSqlRow {
  id: string;
  client_id: string | null;
  name: string;
  permissions: string;
  description: string | null;
  kind: string;
  locked: boolean;
}

const ROLE_COLUMNS = 'id, client_id, name, permissions, description, kind, locked';

const roleRow = (row: RoleSqlRow): RoleRow => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  permissions: row.permissions,
  description: row.description,
  kind: row.kind,
  locked: row.locked,
});

/** The INSERT the create paths share. `ON CONFLICT` policy is the caller's. */
function insertRoleSql(data: RoleCreateData, params: Params, onConflict: string): string {
  return (
    `INSERT INTO roles (id, client_id, name, permissions, description, is_template, kind, locked, updated_at)
     VALUES (${params.add(data.id ?? randomUUID())}, ${params.add(data.clientId)}, ${params.add(data.name)},
             ${params.add(data.permissions)}, ${params.add(data.description)}, ${params.add(data.isTemplate)},
             ${params.add(data.kind ?? 'CUSTOM')}, ${params.add(data.locked ?? false)}, NOW()) ` + onConflict
  );
}

/** The SET list an update/upsert writes, from the closed update shape. */
function roleSetSql(update: RoleUpdateData, params: Params): string {
  return [
    update.name !== undefined ? `name = ${params.add(update.name)}` : null,
    update.description !== undefined ? `description = ${params.add(update.description)}` : null,
    update.permissions !== undefined ? `permissions = ${params.add(update.permissions)}` : null,
    update.kind !== undefined ? `kind = ${params.add(update.kind)}` : null,
    'updated_at = NOW()',
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
}

async function findMany(
  sql: SqlRunner,
  args: Parameters<RoleDelegate['findMany']>[0],
): Promise<RoleRow[]> {
  const params = new Params();
  const order = args.orderBy
    ? 'name' in args.orderBy
      ? `ORDER BY name ${args.orderBy.name === 'desc' ? 'DESC' : 'ASC'}`
      : `ORDER BY created_at ${args.orderBy.createdAt === 'desc' ? 'DESC' : 'ASC'}`
    : '';
  const limit = args.take !== undefined ? `LIMIT ${params.add(args.take)}` : '';
  const offset = args.skip !== undefined ? `OFFSET ${params.add(args.skip)}` : '';
  const { rows } = await sql.query<RoleSqlRow>(
    `SELECT ${ROLE_COLUMNS} FROM roles ${roleWhereSql(args.where, params)} ${order} ${limit} ${offset}`,
    params.values,
  );
  return rows.map(roleRow);
}

async function create(sql: SqlRunner, data: RoleCreateData): Promise<RoleRow> {
  const params = new Params();
  const { rows } = await sql
    .query<RoleSqlRow>(insertRoleSql(data, params, `RETURNING ${ROLE_COLUMNS}`), params.values)
    .catch(rethrowUnique);
  return roleRow(rows[0] as RoleSqlRow);
}

export function roleDelegate(sql: SqlRunner): RoleDelegate {
  return {
    findMany: (args) => findMany(sql, args),
    async findFirst({ where }) {
      const params = new Params();
      const { rows } = await sql.query<RoleSqlRow>(
        `SELECT ${ROLE_COLUMNS} FROM roles ${roleWhereSql(where, params)} LIMIT 1`,
        params.values,
      );
      const row = rows[0];
      return row ? roleRow(row) : null;
    },
    async count({ where }) {
      const params = new Params();
      const { rows } = await sql.query<{ count: string | number }>(
        `SELECT COUNT(*)::int AS count FROM roles ${roleWhereSql(where, params)}`,
        params.values,
      );
      return Number(rows[0]?.count ?? 0);
    },
    create: ({ data }) => create(sql, data),
    async createMany({ data, skipDuplicates }) {
      if (!skipDuplicates) throw new Error('rbac harness: createMany without skipDuplicates');
      let count = 0;
      for (const item of data) {
        const params = new Params();
        const { affectedRows } = await sql.query(
          insertRoleSql(item, params, 'ON CONFLICT DO NOTHING'),
          params.values,
        );
        count += affectedRows ?? 0;
      }
      return { count };
    },
    async upsert({ where, create: createData, update }) {
      const params = new Params();
      const updated = await sql.query<RoleSqlRow>(
        `UPDATE roles SET ${roleSetSql(update, params)}
         WHERE client_id = ${params.add(where.clientId_name.clientId)}
           AND name = ${params.add(where.clientId_name.name)}
         RETURNING ${ROLE_COLUMNS}`,
        params.values,
      );
      const row = updated.rows[0];
      return row ? roleRow(row) : create(sql, createData);
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const { affectedRows } = await sql
        .query(
          `UPDATE roles SET ${roleSetSql(data, params)} ${roleWhereSql(where, params)}`,
          params.values,
        )
        .catch(rethrowUnique);
      return { count: affectedRows ?? 0 };
    },
    async deleteMany({ where }) {
      const params = new Params();
      const { affectedRows } = await sql.query(
        `DELETE FROM roles ${roleWhereSql(where, params)}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}
