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
import type { ShiftDb, ShiftTransaction, ShiftUniqueConstraint } from '@12-apps/shift/types';

import { queryOver } from './shift-db-read';
import { transactionOver } from './shift-db-write';
import type { SqlRunner } from './shift-rows';

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
