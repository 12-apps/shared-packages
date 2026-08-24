/**
 * The `ShiftDb` seam, backed by a REAL Postgres (PGlite).
 *
 * The same arrangement `rbac-db.ts` and `discounts-db.ts` give their surfaces,
 * on the two tables `@12-apps/shift` ships — created by the PACKAGE'S OWN
 * migrations, applied out of the installed tarball. `ShiftDb` is declared
 * structurally so a host can fill it with Prisma; Prisma is what a real host
 * passes, hand-written SQL is what this harness passes, and the point of the
 * seam is that the service cannot tell.
 *
 * ## `resource_assignments` is the HOST'S table, and that is the adoption
 *
 * The package ships `shifts` and `shift_tenant_configs` and nothing else — yet
 * `ShiftTransaction` asks a host to create assignments, check whether one is
 * active, and end it, and `ShiftUniqueConstraint` names an index
 * (`resource_assignments_active_unique_idx`) in a table no migration of its own
 * creates.
 *
 * That is deliberate and it is the interesting half. WHAT a shift claims — a
 * cooking line, a section of the floor, a till — is host domain, so the table
 * that records the claim is the host's, and the package only ever holds the
 * three-column SNAPSHOT it copied onto the shift. A harness that skipped the
 * table would satisfy the seam with stubs and never exercise the exclusivity
 * rule the whole transaction exists for, so this host has a real one.
 *
 * ## Exclusivity is enforced in two places, on purpose
 *
 * A partial unique index refuses a second ACTIVE claim on the same resource,
 * and `lockExclusiveResource` serialises the check-then-insert that precedes
 * it. Neither is redundant: the index is the truth and the lock is what turns a
 * lost race into a wait instead of a 409 the caller did nothing to deserve.
 *
 * PGlite runs a single backend and serialises statements, so the lock cannot be
 * observed to do anything here — it is still taken, because the seam documents
 * `pg_advisory_xact_lock` for Postgres-backed hosts and a host that quietly
 * skipped it would pass this harness and lose the race in production.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import { ShiftError } from '@12-apps/shift';
import type {
  ResourceAssignment,
  Shift,
  ShiftAuditInput,
  ShiftDb,
  ShiftListInput,
  ShiftPage,
  ShiftTransaction,
  ShiftUniqueConstraint,
} from '@12-apps/shift/types';

import {
  AssignmentRow,
  cursorPredicate,
  historyPredicate,
  HISTORY_ORDER,
  Params,
  SHIFT_COLUMNS,
  ShiftRow,
  toAssignment,
  toShift,
  type SqlRunner,
} from './shift-rows';

/** The default page size, matching the package's own driver. */
const DEFAULT_LIMIT = 20;

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/shift/prisma/migrations/', import.meta.url),
);

/**
 * Apply the published migrations, in name order — as a host deploy would.
 *
 * Read out of the installed tarball rather than restated here, so the schema
 * this store writes against is the one the package ships: a column it adds
 * arrives with its migration, and a column it drops takes this file's SQL down
 * with it, loudly.
 *
 * Order matters beyond the usual: the folder's THIRD migration retires a CHECK
 * that named the origin host's two staff kinds, and applying only the first
 * would leave this host unable to open a shift of its own at all.
 */
export async function applyShiftMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/**
 * The host's assignment table, plus the audit sink the seam writes through.
 *
 * `resource_assignments` mirrors the columns the origin host has, including the
 * partial unique index the package names in `ShiftUniqueConstraint` — the name
 * is part of the contract, since `isUniqueViolation` is asked about it by name.
 *
 * `shift_audits` stands in for whatever a host already has. The origin host
 * routes these through `@12-apps/audit`; a table is enough to prove the seam is
 * called with the right before/after pairs, and keeping it separate from
 * `audit_logs` means a shift suite asserting its own writes cannot be confused
 * by the audit harness's seeded rows.
 */
export async function createShiftHostTables(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS "resource_assignments" (
      "id"            TEXT NOT NULL PRIMARY KEY,
      "client_id"     TEXT NOT NULL,
      "user_id"       TEXT NOT NULL,
      "resource_type" TEXT NOT NULL,
      "resource_id"   TEXT NOT NULL,
      "valid_from"    TIMESTAMP(3) NOT NULL,
      "valid_to"      TIMESTAMP(3)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "resource_assignments_active_unique_idx"
      ON "resource_assignments"("client_id", "resource_type", "resource_id")
      WHERE "valid_to" IS NULL;
    CREATE TABLE IF NOT EXISTS "shift_audits" (
      "id"             BIGSERIAL PRIMARY KEY,
      "client_id"      TEXT NOT NULL,
      "actor_user_id"  TEXT,
      "action"         TEXT NOT NULL,
      "resource_type"  TEXT NOT NULL,
      "resource_id"    TEXT NOT NULL,
      "before"         JSONB NOT NULL,
      "after"          JSONB NOT NULL,
      "written_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** The read half, over whichever runner the caller is inside. */
function queryOver(sql: SqlRunner) {
  return {
    async getShift(clientId: string, shiftId: string): Promise<Shift | null> {
      const params = new Params();
      const { rows } = await sql.query<ShiftRow>(
        `SELECT ${SHIFT_COLUMNS} FROM shifts
         WHERE client_id = ${params.add(clientId)} AND id = ${params.add(shiftId)}`,
        params.values,
      );
      return rows[0] ? toShift(rows[0]) : null;
    },

    async getOpenShift(clientId: string, userId: string): Promise<Shift | null> {
      const params = new Params();
      const { rows } = await sql.query<ShiftRow>(
        `SELECT ${SHIFT_COLUMNS} FROM shifts
         WHERE client_id = ${params.add(clientId)} AND user_id = ${params.add(userId)}
           AND ended_at IS NULL`,
        params.values,
      );
      return rows[0] ? toShift(rows[0]) : null;
    },

    async listOpenShifts(clientId: string, kind?: string): Promise<Shift[]> {
      const params = new Params();
      const where = [`client_id = ${params.add(clientId)}`, 'ended_at IS NULL'];
      if (kind !== undefined) where.push(`kind = ${params.add(kind)}`);
      const { rows } = await sql.query<ShiftRow>(
        `SELECT ${SHIFT_COLUMNS} FROM shifts WHERE ${where.join(' AND ')} ${HISTORY_ORDER}`,
        params.values,
      );
      return rows.map(toShift);
    },

    async listShifts(
      input: Required<Pick<ShiftListInput, 'clientId' | 'limit'>> &
        Omit<ShiftListInput, 'clientId' | 'limit'>,
    ): Promise<ShiftPage> {
      const params = new Params();
      const where = [historyPredicate(input, params)];

      if (input.cursor !== undefined) {
        // Resolve the cursor to its ordering key first. An id that is not in
        // this client's history is REJECTED rather than treated as "start from
        // the top" — the package's in-memory driver throws INVALID_SHIFT there,
        // and a store that silently restarted the page would hide a client
        // paging through a filter it no longer matches.
        const anchorParams = new Params();
        const { rows } = await sql.query<{ started_at: Date | string; id: string }>(
          `SELECT started_at, id FROM shifts
           WHERE client_id = ${anchorParams.add(input.clientId)}
             AND id = ${anchorParams.add(input.cursor)}`,
          anchorParams.values,
        );
        const anchor = rows[0];
        if (!anchor) throw unknownCursor(input.cursor);
        where.push(
          cursorPredicate(
            {
              startedAt: anchor.started_at instanceof Date
                ? anchor.started_at
                : new Date(anchor.started_at),
              id: anchor.id,
            },
            params,
          ),
        );
      }

      const limit = input.limit || DEFAULT_LIMIT;
      // One more than asked for, so "is there another page" is answered by the
      // rows themselves rather than by a second COUNT that could disagree with
      // them under a concurrent insert.
      const { rows } = await sql.query<ShiftRow>(
        `SELECT ${SHIFT_COLUMNS} FROM shifts
         WHERE ${where.join(' AND ')} ${HISTORY_ORDER} LIMIT ${limit + 1}`,
        params.values,
      );
      const items = rows.slice(0, limit).map(toShift);
      const nextCursor = rows.length > limit ? (items[items.length - 1]?.id ?? null) : null;
      return { items, nextCursor };
    },

    async listOpenStartedBefore(detectedAt: Date): Promise<Shift[]> {
      const params = new Params();
      // Deliberately NOT narrowed to an hour, unlike the note on the seam
      // permits: the sweep's per-tenant cutoff is the service's business, and a
      // host that pre-filtered here would make the service's own window
      // untestable — the case that matters is a tenant whose window is shorter
      // than the host's guess.
      const { rows } = await sql.query<ShiftRow>(
        `SELECT ${SHIFT_COLUMNS} FROM shifts
         WHERE ended_at IS NULL AND started_at < ${params.add(detectedAt)} ${HISTORY_ORDER}`,
        params.values,
      );
      return rows.map(toShift);
    },
  };
}

/**
 * The package's own error for a cursor it cannot resolve.
 *
 * A real `ShiftError`, not a look-alike carrying a `code` property: the http
 * entry maps a refusal to its status with `instanceof`, so anything else falls
 * through `answering()` untouched and answers 500. That is precisely the shape
 * of the `exports`-map defect this adoption uncovered — worth not recreating
 * one file below where it was fixed.
 */
function unknownCursor(cursor: string): ShiftError {
  return new ShiftError('INVALID_SHIFT', `Unknown pagination cursor: ${cursor}.`);
}

/** The write half, only ever reachable inside a transaction. */
function transactionOver(sql: SqlRunner): ShiftTransaction {
  const read = queryOver(sql);
  return {
    getShift: read.getShift,
    getOpenShift: read.getOpenShift,

    async lockExclusiveResource(clientId, resourceType, resourceId) {
      // `hashtextextended` rather than a pair of `hashtext`s: the two-argument
      // advisory lock takes int4s, and folding three strings into two int4s
      // collides far more readily than into one int8 — a false collision here
      // is two unrelated resources serialising against each other, which is a
      // silent throughput bug rather than a wrong answer.
      const params = new Params();
      await sql.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended(${params.add(`${clientId}:${resourceType}:${resourceId}`)}, 0))`,
        params.values,
      );
    },

    async isResourceActive(clientId, resourceType, resourceId, at) {
      const params = new Params();
      // `valid_to IS NULL OR valid_to > at`, and deliberately NOT gated on
      // `valid_from <= at` — the seam spells out why: a claim that starts later
      // still conflicts with one opening now, and treating it as free hands the
      // same resource to two workers with the later claim silently winning.
      const { rows } = await sql.query<{ one: number }>(
        `SELECT 1 AS one FROM resource_assignments
         WHERE client_id = ${params.add(clientId)}
           AND resource_type = ${params.add(resourceType)}
           AND resource_id = ${params.add(resourceId)}
           AND (valid_to IS NULL OR valid_to > ${params.add(at)})
         LIMIT 1`,
        params.values,
      );
      return rows.length > 0;
    },

    async createAssignment(input): Promise<ResourceAssignment> {
      const params = new Params();
      const { rows } = await sql.query<AssignmentRow>(
        `INSERT INTO resource_assignments
           (id, client_id, user_id, resource_type, resource_id, valid_from, valid_to)
         VALUES (${params.add(input.id)}, ${params.add(input.clientId)},
                 ${params.add(input.userId)}, ${params.add(input.resourceType)},
                 ${params.add(input.resourceId)}, ${params.add(input.validFrom)}, NULL)
         RETURNING id, client_id, user_id, resource_type, resource_id, valid_from, valid_to`,
        params.values,
      );
      const row = rows[0];
      if (!row) throw new Error('resource_assignments INSERT returned no row');
      return toAssignment(row);
    },

    async createShift(shift): Promise<Shift> {
      const params = new Params();
      const { rows } = await sql.query<ShiftRow>(
        `INSERT INTO shifts
           (id, client_id, user_id, kind, started_at, ended_at, ended_reason,
            ended_by_user_id, resource_assignment_id, resource_type, resource_id)
         VALUES (${params.add(shift.id)}, ${params.add(shift.clientId)},
                 ${params.add(shift.userId)}, ${params.add(shift.kind)},
                 ${params.add(shift.startedAt)}, NULL, NULL, NULL,
                 ${params.add(shift.resourceAssignmentId)},
                 ${params.add(shift.resourceType)}, ${params.add(shift.resourceId)})
         RETURNING ${SHIFT_COLUMNS}`,
        params.values,
      );
      const row = rows[0];
      if (!row) throw new Error('shifts INSERT returned no row');
      return toShift(row);
    },

    async endShift(input): Promise<Shift | null> {
      const params = new Params();
      // `ended_at IS NULL` in the predicate, not a read-then-write: closing an
      // already-closed shift has to be distinguishable from closing a missing
      // one, and the package reads a null return as "nothing to close". The
      // package's own trigger would refuse the UPDATE anyway; answering null is
      // what turns that into its 409 instead of a 500.
      const { rows } = await sql.query<ShiftRow>(
        `UPDATE shifts
            SET ended_at = ${params.add(input.endedAt)},
                ended_reason = ${params.add(input.endedReason)},
                ended_by_user_id = ${params.add(input.endedByUserId)}
          WHERE client_id = ${params.add(input.clientId)}
            AND id = ${params.add(input.shiftId)}
            AND ended_at IS NULL
        RETURNING ${SHIFT_COLUMNS}`,
        params.values,
      );
      return rows[0] ? toShift(rows[0]) : null;
    },

    async endAssignment(input): Promise<boolean> {
      const params = new Params();
      const { rows } = await sql.query<{ id: string }>(
        `UPDATE resource_assignments
            SET valid_to = ${params.add(input.validTo)}
          WHERE client_id = ${params.add(input.clientId)}
            AND id = ${params.add(input.assignmentId)}
            AND valid_to IS NULL
        RETURNING id`,
        params.values,
      );
      return rows.length > 0;
    },

    async writeAudit(input: ShiftAuditInput): Promise<void> {
      const params = new Params();
      await sql.query(
        `INSERT INTO shift_audits
           (client_id, actor_user_id, action, resource_type, resource_id, before, after)
         VALUES (${params.add(input.clientId)}, ${params.add(input.actorUserId)},
                 ${params.add(input.action)}, ${params.add(input.resourceType)},
                 ${params.add(input.resourceId)}, ${params.add(JSON.stringify(input.before))},
                 ${params.add(JSON.stringify(input.after))})`,
        params.values,
      );
    },
  };
}

/**
 * The seam a host fills with Prisma, filled here with SQL over PGlite.
 *
 * `isUniqueViolation` is asked about a constraint BY NAME, which is why the
 * host's index above had to keep the package's name: the service distinguishes
 * "this user already has a shift open" from "that resource is taken" purely by
 * which constraint fired, and a renamed index makes both answer the same 409
 * with the wrong sentence.
 */
export function shiftDb(pg: PGlite): ShiftDb {
  return {
    ...queryOver(pg as unknown as SqlRunner),
    transaction: <T>(work: (tx: ShiftTransaction) => Promise<T>): Promise<T> =>
      pg.transaction((tx) => work(transactionOver(tx as unknown as SqlRunner))) as Promise<T>,
    isUniqueViolation(error: unknown, constraint: ShiftUniqueConstraint): boolean {
      const message = error instanceof Error ? error.message : String(error);
      // Postgres names the index in the detail of a 23505; matching on the name
      // is what a Prisma-backed host gets from `error.meta.target`.
      return /unique|duplicate key/i.test(message) && message.includes(constraint);
    },
  };
}
