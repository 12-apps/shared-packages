/**
 * The realtime OUTBOX seam, backed by a REAL Postgres (12-16).
 *
 * The same arrangement `rbac-db.ts` and `lifecycle-db.ts` give their surfaces: PGlite is a
 * real Postgres, the table is created by the PACKAGE'S OWN migration applied out of the
 * installed tarball, and the delegate below is duck-typed against
 * `RealtimeOutboxDrainDb` / `RealtimeOutboxWriteDb` — which the package defines
 * structurally so a host can fill it with Prisma. Prisma is what a real host passes;
 * hand-written SQL is what this harness passes, and the point of the seam is that the drain
 * cannot tell.
 *
 * ## Why the SQL, not a fake, is the interesting part
 *
 * The drain's whole safety property is that a CLAIM is one conditional `UPDATE`, so the
 * DATABASE decides which of two racing drains wins. A hand-rolled in-memory fake can model
 * that (the package's own unit tests do), but only a real database proves the SQL those
 * argument shapes translate to is the SQL that was meant: the predicate really carries every
 * clause, and `affectedRows` really is 0 for the loser.
 *
 * What it does NOT prove, and the docstring used to claim: PostgreSQL's row lock and its
 * READ COMMITTED re-check. PGlite is single-backend and serializes queries, so no two
 * statements are ever concurrently inside one. What the twenty-rows/six-drains case does
 * prove is the INTERLEAVING hazard — all six `findMany`s complete before any claim, which a
 * read-validate-write drain genuinely fails — and that is the bug class the shape exists to
 * make unrepresentable. A real-Postgres service container would be needed for the lock
 * itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type {
  RealtimeOutboxDrainDb,
  RealtimeOutboxRow,
  RealtimeOutboxWriteDb,
} from '@12-apps/realtime/server';

import { Params, type SqlRunner } from './rbac-db-shared';

/**
 * Located by path rather than by `require.resolve`, and read out of `node_modules`: these
 * are shipped ASSETS, not module entry points, and a host copies them with a script rather
 * than importing them.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/realtime/prisma/migrations/', import.meta.url),
);

/** Every published realtime migration, in the order Prisma applies them. */
export function realtimeMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The SQL of one migration, straight out of the tarball. */
export function realtimeMigrationSql(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8');
}

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyRealtimeMigrations(pg: PGlite): Promise<void> {
  const names = realtimeMigrations();
  // Zero would leave every query below failing on a missing table, reported as "relation
  // realtime_outbox_events does not exist" rather than as the packaging mistake it is.
  if (names.length === 0) throw new Error(`No realtime migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) await pg.exec(realtimeMigrationSql(name));
}

interface OutboxSqlRow {
  id: string;
  topic: string;
  type: string;
  data: unknown;
  attempts: number;
}

const outboxRow = (row: OutboxSqlRow): RealtimeOutboxRow => ({
  id: row.id,
  topic: row.topic,
  type: row.type,
  data: row.data,
  attempts: row.attempts,
});

/**
 * "Unclaimed, or claimed long enough ago that the lease lapsed", translated from the seam's
 * `OR` pair.
 *
 * The package documents its argument shapes as CLOSED sets — anything outside them throws
 * here rather than being silently dropped, because a claim predicate that quietly lost a
 * clause is exactly how two drains would both publish a row.
 */
function claimableSql(
  or: [{ claimedAt: null }, { claimedAt: { lt: Date } }],
  params: Params,
): string {
  const [free, stale] = or;
  if (free.claimedAt !== null || !(stale.claimedAt.lt instanceof Date)) {
    throw new Error('realtimeOutboxEvent: unexpected claim predicate');
  }
  return `(claimed_at IS NULL OR claimed_at < ${params.add(stale.claimedAt.lt)})`;
}

/** The drain's read/claim/mark surface, over SQL. */
export function realtimeOutboxDrainDb(sql: SqlRunner): RealtimeOutboxDrainDb {
  return {
    realtimeOutboxEvent: {
      async findMany({ where, take }) {
        const params = new Params();
        const clause = [
          'published_at IS NULL',
          `attempts < ${params.add(where.attempts.lt)}`,
          claimableSql(where.OR, params),
        ].join(' AND ');
        const { rows } = await sql.query<OutboxSqlRow>(
          `SELECT id, topic, type, data, attempts FROM realtime_outbox_events
             WHERE ${clause} ORDER BY created_at ASC, id ASC LIMIT ${params.add(take)}`,
          params.values,
        );
        return rows.map(outboxRow);
      },

      async updateMany({ where, data }) {
        const params = new Params();
        const conditions = [`id = ${params.add(where.id)}`];
        if (where.publishedAt === null) conditions.push('published_at IS NULL');
        if (where.claimedBy !== undefined) {
          conditions.push(`claimed_by = ${params.add(where.claimedBy)}`);
        }
        if (where.OR) conditions.push(claimableSql(where.OR, params));

        let assignments: string;
        if ('claimedAt' in data && data.claimedAt instanceof Date) {
          const claim = data as { claimedAt: Date; claimedBy: string };
          assignments =
            `claimed_at = ${params.add(claim.claimedAt)}, ` +
            `claimed_by = ${params.add(claim.claimedBy)}, attempts = attempts + 1`;
        } else if ('publishedAt' in data) {
          const mark = data as { publishedAt: Date };
          assignments =
            `published_at = ${params.add(mark.publishedAt)}, claimed_at = NULL, last_error = NULL`;
        } else {
          const release = data as { lastError: string; attempts?: { decrement: 1 } };
          assignments = `claimed_at = NULL, last_error = ${params.add(release.lastError)}`;
          // The REFUND shape: a global fault (no driver in this process) gives the
          // claim's attempt back, because `attempts` is a per-row budget for a row nobody
          // can publish — not a counter for a deployment-wide outage. An adapter that
          // dropped this clause would be the silently-lost-clause failure the package's
          // closed argument shapes exist to prevent.
          if (release.attempts) assignments += ', attempts = attempts - 1';
        }

        const { affectedRows } = await sql.query(
          `UPDATE realtime_outbox_events SET ${assignments} WHERE ${conditions.join(' AND ')}`,
          params.values,
        );
        return { count: affectedRows ?? 0 };
      },

      async deleteMany({ where }) {
        const params = new Params();
        const { affectedRows } = await sql.query(
          `DELETE FROM realtime_outbox_events
             WHERE published_at IS NOT NULL AND published_at < ${params.add(where.publishedAt.lt)}`,
          params.values,
        );
        return { count: affectedRows ?? 0 };
      },
    },
  };
}

/** The enqueue surface, over SQL — what a domain write's transaction is handed. */
export function realtimeOutboxWriteDb(sql: SqlRunner): RealtimeOutboxWriteDb {
  return {
    realtimeOutboxEvent: {
      async create({ data }) {
        const params = new Params();
        await sql.query(
          `INSERT INTO realtime_outbox_events (id, topic, type, data)
             VALUES (gen_random_uuid()::text, ${params.add(data.topic)},
                     ${params.add(data.type)}, ${params.add(JSON.stringify(data.data))}::jsonb)`,
          params.values,
        );
        return undefined;
      },
    },
  };
}

/** A PGlite with the published realtime migrations applied, and nothing else. */
export async function openRealtimeDb(): Promise<PGlite> {
  const pg = new PGlite();
  await applyRealtimeMigrations(pg);
  return pg;
}

/** Read a row back, for assertions about what the drain actually wrote. */
export async function readOutboxRow(
  pg: PGlite,
  id: string,
): Promise<{
  publishedAt: Date | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  attempts: number;
  lastError: string | null;
} | null> {
  const { rows } = await pg.query<{
    published_at: Date | null;
    claimed_at: Date | null;
    claimed_by: string | null;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT published_at, claimed_at, claimed_by, attempts, last_error
       FROM realtime_outbox_events WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    publishedAt: row.published_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

/** Every pending row's id, in the order the drain would claim them. */
export async function pendingOutboxIds(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id FROM realtime_outbox_events WHERE published_at IS NULL
       ORDER BY created_at ASC, id ASC`,
  );
  return rows.map((row) => row.id);
}
