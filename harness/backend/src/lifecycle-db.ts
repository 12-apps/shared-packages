/**
 * The `LifecycleDb` seam, backed by a REAL Postgres (12-17).
 *
 * The same arrangement `rbac-db.ts` gives the RBAC surface, on the four
 * lifecycle tables: PGlite is a real Postgres, the tables are created by the
 * PACKAGE'S OWN migrations applied out of the installed tarball, and the
 * delegates below are duck-typed against `LifecycleDb` — which the package
 * defines structurally so a host can fill it with Prisma. Prisma is what a
 * real host passes; hand-written SQL is what this harness passes, and the
 * point of the seam is that the stores cannot tell.
 *
 * The package documents its argument shapes as CLOSED sets
 * (`@12-apps/entity-lifecycle/server`, `db.ts`) — anything outside them
 * throws here rather than guessing.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type {
  EntityVersionDelegate,
  EntityVersionRow,
  LifecycleDb,
  LifecycleDbClient,
  RecycleBinDelegate,
  RecycleBinRow,
} from '@12-apps/entity-lifecycle/server';

import { draftDelegate, requestDelegate } from './lifecycle-db-review';
import { Params, type SqlRunner } from './rbac-db-shared';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/entity-lifecycle/prisma/migrations/', import.meta.url),
);

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyLifecycleMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

interface VersionSqlRow {
  id: string;
  client_id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  kind: string;
  is_snapshot: boolean;
  data: unknown;
  removed_fields: unknown;
  actor_id: string | null;
  restored_from: number | null;
  created_at: Date;
}

const versionRow = (row: VersionSqlRow): EntityVersionRow => ({
  id: row.id,
  clientId: row.client_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  version: row.version,
  kind: row.kind,
  isSnapshot: row.is_snapshot,
  data: row.data,
  removedFields: row.removed_fields,
  actorId: row.actor_id,
  restoredFrom: row.restored_from,
  createdAt: row.created_at,
});

function versionDelegate(sql: SqlRunner): EntityVersionDelegate {
  const scope = (
    where: { clientId: string; entityType: string; entityId: string },
    params: Params,
  ): string =>
    `client_id = ${params.add(where.clientId)} AND entity_type = ${params.add(
      where.entityType,
    )} AND entity_id = ${params.add(where.entityId)}`;
  return {
    async create({ data }) {
      const params = new Params();
      const { rows } = await sql.query<VersionSqlRow>(
        `INSERT INTO entity_versions
           (id, client_id, entity_type, entity_id, version, kind, is_snapshot, data,
            removed_fields, actor_id, restored_from)
         VALUES (${params.add(randomUUID())}, ${params.add(data.clientId)},
                 ${params.add(data.entityType)}, ${params.add(data.entityId)},
                 ${params.add(data.version)}, ${params.add(data.kind)},
                 ${params.add(data.isSnapshot)}, ${params.add(JSON.stringify(data.data))}::jsonb,
                 ${params.add(JSON.stringify(data.removedFields))}::jsonb,
                 ${params.add(data.actorId)}, ${params.add(data.restoredFrom)})
         RETURNING *`,
        params.values,
      );
      return versionRow(rows[0] as VersionSqlRow);
    },
    async findMany({ where, orderBy }) {
      const params = new Params();
      const { rows } = await sql.query<VersionSqlRow>(
        `SELECT * FROM entity_versions WHERE ${scope(where, params)}
         ORDER BY version ${orderBy.version === 'asc' ? 'ASC' : 'DESC'}`,
        params.values,
      );
      return rows.map(versionRow);
    },
    async findFirst({ where, orderBy }) {
      const params = new Params();
      const { rows } = await sql.query<VersionSqlRow>(
        `SELECT * FROM entity_versions WHERE ${scope(where, params)}
         ORDER BY version ${orderBy.version === 'asc' ? 'ASC' : 'DESC'} LIMIT 1`,
        params.values,
      );
      const row = rows[0];
      return row ? versionRow(row) : null;
    },
    async deleteMany({ where }) {
      const params = new Params();
      let clause = scope(where, params);
      if (typeof where.version === 'object' && where.version !== null) {
        if (where.version.in.length === 0) return { count: 0 };
        clause += ` AND version IN (${where.version.in
          .map((value) => params.add(value))
          .join(', ')})`;
      } else if (where.version !== undefined) {
        clause += ` AND version = ${params.add(where.version)}`;
      }
      const { affectedRows } = await sql.query(
        `DELETE FROM entity_versions WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
    async updateMany({ where, data }) {
      if (typeof where.version !== 'number') {
        throw new Error('entityVersion.updateMany expects a single version');
      }
      const params = new Params();
      const assignments = `is_snapshot = ${params.add(data.isSnapshot)},
        data = ${params.add(JSON.stringify(data.data))}::jsonb,
        removed_fields = ${params.add(JSON.stringify(data.removedFields))}::jsonb`;
      const clause = `${scope(where, params)} AND version = ${params.add(where.version)}`;
      const { affectedRows } = await sql.query(
        `UPDATE entity_versions SET ${assignments} WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

interface BinSqlRow {
  id: string;
  client_id: string;
  entity_type: string;
  entity_id: string;
  parent_entry_id: string | null;
  label: string;
  snapshot: unknown;
  status: string;
  deleted_by: string | null;
  deleted_at: Date;
}

const binRow = (row: BinSqlRow): RecycleBinRow => ({
  id: row.id,
  clientId: row.client_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  parentEntryId: row.parent_entry_id,
  label: row.label,
  snapshot: row.snapshot,
  status: row.status,
  deletedBy: row.deleted_by,
  deletedAt: row.deleted_at,
});

function binWhereSql(
  where: {
    clientId: string;
    id?: string | { in: string[] };
    entityType?: string;
    status?: string;
    parentEntryId?: null | { in: string[] };
  },
  params: Params,
): string {
  const conditions = [`client_id = ${params.add(where.clientId)}`];
  if (typeof where.id === 'string') conditions.push(`id = ${params.add(where.id)}`);
  else if (where.id !== undefined) {
    if (where.id.in.length === 0) return 'FALSE';
    conditions.push(`id IN (${where.id.in.map((value) => params.add(value)).join(', ')})`);
  }
  if (where.entityType !== undefined) {
    conditions.push(`entity_type = ${params.add(where.entityType)}`);
  }
  if (where.status !== undefined) conditions.push(`status = ${params.add(where.status)}`);
  if (where.parentEntryId === null) conditions.push('parent_entry_id IS NULL');
  else if (where.parentEntryId !== undefined) {
    if (where.parentEntryId.in.length === 0) return 'FALSE';
    conditions.push(
      `parent_entry_id IN (${where.parentEntryId.in
        .map((value) => params.add(value))
        .join(', ')})`,
    );
  }
  return conditions.join(' AND ');
}

function binDelegate(sql: SqlRunner): RecycleBinDelegate {
  return {
    async create({ data }) {
      const params = new Params();
      const { rows } = await sql.query<BinSqlRow>(
        `INSERT INTO recycle_bin_entries
           (id, client_id, entity_type, entity_id, parent_entry_id, label, snapshot,
            deleted_by, updated_at)
         VALUES (${params.add(randomUUID())}, ${params.add(data.clientId)},
                 ${params.add(data.entityType)}, ${params.add(data.entityId)},
                 ${params.add(data.parentEntryId)}, ${params.add(data.label)},
                 ${params.add(JSON.stringify(data.snapshot))}::jsonb,
                 ${params.add(data.deletedBy)}, NOW())
         RETURNING *`,
        params.values,
      );
      return binRow(rows[0] as BinSqlRow);
    },
    async findFirst({ where }) {
      const params = new Params();
      const { rows } = await sql.query<BinSqlRow>(
        `SELECT * FROM recycle_bin_entries WHERE ${binWhereSql(where, params)} LIMIT 1`,
        params.values,
      );
      const row = rows[0];
      return row ? binRow(row) : null;
    },
    async findMany({ where, orderBy }) {
      const params = new Params();
      const { rows } = await sql.query<BinSqlRow>(
        `SELECT * FROM recycle_bin_entries WHERE ${binWhereSql(where, params)}
         ORDER BY deleted_at ${orderBy.deletedAt === 'asc' ? 'ASC' : 'DESC'}, id`,
        params.values,
      );
      return rows.map(binRow);
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const clause = binWhereSql(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE recycle_bin_entries
           SET status = ${params.add(data.status)}, updated_at = NOW()
         WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

function clientOver(sql: SqlRunner): LifecycleDbClient {
  return {
    entityVersion: versionDelegate(sql),
    recycleBinEntry: binDelegate(sql),
    entityDraft: draftDelegate(sql),
    changeRequest: requestDelegate(sql),
  };
}

/** The seam a host fills with Prisma, filled here with SQL over PGlite. */
export function lifecycleDb(pg: PGlite): LifecycleDb {
  return {
    ...clientOver(pg as unknown as SqlRunner),
    $transaction: (fn) =>
      pg.transaction((tx) => fn(clientOver(tx as unknown as SqlRunner))),
  };
}
