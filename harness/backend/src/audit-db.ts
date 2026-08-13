/**
 * The `AuditDb` seam, backed by a REAL Postgres (12-14).
 *
 * The same arrangement `saved-report-db.ts` and `rbac-db.ts` give their
 * surfaces: PGlite is a real Postgres, the table is created by the PACKAGE'S
 * OWN migration applied out of the installed tarball, and the delegate is
 * duck-typed against `AuditDb` — which the package defines structurally so a
 * host can fill it with Prisma. Prisma is what a real host passes; hand-written
 * SQL is what this harness passes, and the point of the seam is that the writer
 * and the routes cannot tell.
 *
 * Nothing here restates the schema: a column the package adds arrives with its
 * migration, and a column it drops takes this file's SQL down with it, loudly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type { AuditDb, AuditLogRecord, AuditLogWhere } from '@12-apps/audit/server';

/**
 * The package's migrations, located by PATH inside the installed package — the
 * idiom the other harness suites use, because these are shipped ASSETS rather
 * than module entry points.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/audit/prisma/migrations/', import.meta.url),
);

/** Every published migration, in name order — the order Prisma applies them. */
export function auditMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'),
    }));
}

/** Apply the published migrations as a host deploy would. */
export async function applyAuditMigrations(pg: PGlite): Promise<void> {
  for (const migration of auditMigrations()) await pg.exec(migration.sql);
}

/** What a `$queryRaw`-free host has to translate: one table, three operations. */
interface Row {
  id: string;
  client_id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  scope: string | null;
  on_behalf_of_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before: unknown;
  after: unknown;
  request_id: string | null;
  created_ms: number;
}

const SELECT = `id, client_id, actor_user_id, actor_role, scope, on_behalf_of_user_id,
  action, resource_type, resource_id, before, after, request_id,
  EXTRACT(EPOCH FROM created_at) * 1000 AS created_ms`;

/**
 * `created_at` is `timestamp(3)` — no time zone — and a driver parses one
 * through the HOST machine's zone, so a row written at 12:00Z reads back as
 * 15:00Z under `TZ=America/Sao_Paulo`. Prisma's convention is that the naive
 * column holds UTC; `EXTRACT(EPOCH …)` reads it that way, and the result is the
 * same instant on every machine.
 */
const toRecord = (row: Row): AuditLogRecord => ({
  id: row.id,
  createdAt: new Date(Number(row.created_ms)),
  actorUserId: row.actor_user_id,
  actorRole: row.actor_role,
  scope: row.scope,
  onBehalfOfUserId: row.on_behalf_of_user_id,
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  before: row.before,
  after: row.after,
  requestId: row.request_id,
});

/** Translate the CLOSED `AuditLogWhere` shapes into SQL + bound parameters. */
function predicate(where: AuditLogWhere): { sql: string; values: unknown[] } {
  const values: unknown[] = [where.clientId];
  const clauses = ['client_id = $1'];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (where.actorUserId !== undefined) clauses.push(`actor_user_id = ${bind(where.actorUserId)}`);
  if (typeof where.resourceId === 'string') {
    clauses.push(`resource_id = ${bind(where.resourceId)}`);
  } else if (where.resourceId) {
    clauses.push(`resource_id ILIKE ${bind(`%${where.resourceId.contains}%`)}`);
  }
  if (where.action) clauses.push(`action = ANY(${bind(where.action.in)})`);
  if (where.resourceType) clauses.push(`resource_type = ANY(${bind(where.resourceType.in)})`);
  if (where.createdAt?.gte) clauses.push(`created_at >= ${bind(where.createdAt.gte)}`);
  if (where.createdAt?.lt) clauses.push(`created_at < ${bind(where.createdAt.lt)}`);
  return { sql: clauses.join(' AND '), values };
}

/** The seam a host fills with Prisma, filled here with SQL over PGlite. */
export function auditDb(pg: PGlite): AuditDb {
  return {
    auditLog: {
      async create({ data }) {
        // No `id` from the writer: `@default(uuid())` is a Prisma-side default,
        // so generating one is the seam's job — exactly as it would be for any
        // host that does not go through Prisma.
        await pg.query(
          `INSERT INTO audit_logs (id, client_id, actor_user_id, actor_role, scope,
             on_behalf_of_user_id, action, resource_type, resource_id, before, after, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            crypto.randomUUID(),
            data.clientId,
            data.actorUserId,
            data.actorRole,
            data.scope,
            data.onBehalfOfUserId,
            data.action,
            data.resourceType,
            data.resourceId,
            JSON.stringify(data.before),
            JSON.stringify(data.after),
            data.requestId,
          ],
        );
        return {};
      },
      async findMany({ where, skip, take }) {
        const { sql, values } = predicate(where);
        const { rows } = await pg.query<Row>(
          `SELECT ${SELECT} FROM audit_logs WHERE ${sql}
           ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, take, skip],
        );
        return rows.map(toRecord);
      },
      async count({ where }) {
        const { sql, values } = predicate(where);
        const { rows } = await pg.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM audit_logs WHERE ${sql}`,
          values,
        );
        return Number(rows[0]?.total ?? 0);
      },
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]) {
      const { affectedRows } = await pg.query(query, values);
      return affectedRows ?? 0;
    },
  };
}
