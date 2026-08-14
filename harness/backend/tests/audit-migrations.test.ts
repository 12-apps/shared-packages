/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations,
   test-flakiness/no-long-text-match --
   the filesystem and the database ARE the subject: this asserts that the
   migration inside the PUBLISHED @12-apps/audit tarball applies to a real
   Postgres, and that it applies to one that already has the table. Every path
   read is inside the installed package and the database is a fresh in-process
   PGlite per test. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/audit ships its model AND its migration (12-14), and a host applies
 * them — the same contract the payments/rbac migration suites pin, plus the one
 * property this package promises that they do not: the migration is REPLAY-SAFE.
 *
 * That property is not a nicety. A package migration is applied in name order, so
 * it sorts AFTER the migrations a host already had; the first adopter of this
 * package already HAS an `audit_logs` table. A bare `CREATE TABLE` would fail
 * `migrate deploy` there — and on a fresh database built from the whole folder —
 * and the only remedy is `prisma migrate resolve --applied`, by hand, once per
 * database. Three PRs in this series hit that wall. So the cases below apply the
 * migration to a database that already has the table, and to one that has an
 * OLDER shape of it, and expect both to succeed.
 */
const auditPackage = fileURLToPath(new URL('../node_modules/@12-apps/audit/', import.meta.url));
const migrationsDir = join(auditPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const sqlOf = (name: string): string =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');

async function applyAll(db: PGlite): Promise<void> {
  for (const name of migrations()) await db.exec(sqlOf(name));
}

/** The columns the published partial declares, in snake_case. */
const COLUMNS = [
  'id',
  'client_id',
  'actor_user_id',
  'actor_role',
  'scope',
  'on_behalf_of_user_id',
  'action',
  'resource_type',
  'resource_id',
  'before',
  'after',
  'request_id',
  'created_at',
];

async function columnsOf(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_logs'",
  );
  return rows.map((row) => row.column_name).sort();
}

describe('@12-apps/audit — the prisma assets survive publication', () => {
  it('ships its schema partial with the AuditLog model and the attribution PAIR', () => {
    const partial = readFileSync(join(auditPackage, 'prisma/audit.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+AuditLog\s/);
    // Both halves, or the trail cannot answer "who really did this" and "who did
    // the screen claim to be" independently.
    expect(partial).toContain('actorUserId');
    expect(partial).toContain('onBehalfOfUserId');
    // No FK into a host table: the package-schema doctrine.
    expect(partial).not.toMatch(/@relation/);
  });

  it('ships the prisma:sync script the adoption contract names', () => {
    // ADOPTING.md tells a host to run the package's own sync script; a `files`
    // list that drops `scripts/` turns that instruction into MODULE_NOT_FOUND on
    // every real install (it works in a workspace, which is the trap).
    const script = readFileSync(join(auditPackage, 'scripts/sync-audit-schema.mjs'), 'utf-8');
    expect(script).toContain('audit.prisma');
  });

  it('ships at least one migration, and none of them empty', () => {
    expect(migrations().length).toBeGreaterThan(0);
    expect(migrations().filter((name) => sqlOf(name).trim().length === 0)).toEqual([]);
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        await expect(db.exec(sqlOf(name)), `migration ${name}`).resolves.toBeDefined();
      }
      expect(await columnsOf(db)).toEqual([...COLUMNS].sort());
    } finally {
      await db.close();
    }
  });

  it('creates the indexes the viewer and the sweep read', async () => {
    const db = new PGlite();
    try {
      await applyAll(db);
      const { rows } = await db.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs'",
      );
      const names = rows.map((row) => row.indexname);
      for (const index of [
        'audit_logs_client_id_created_at_idx',
        'audit_logs_client_id_actor_user_id_created_at_idx',
        'audit_logs_client_id_resource_type_resource_id_idx',
        'audit_logs_client_id_action_resource_type_created_at_idx',
        'audit_logs_created_at_idx',
      ]) {
        expect(names, index).toContain(index);
      }
    } finally {
      await db.close();
    }
  });
});

describe('replay safety — a host that already has the table needs no baselining', () => {
  it('REPLAYS the whole folder onto itself without failing', async () => {
    const db = new PGlite();
    try {
      await applyAll(db);
      await db.query(
        `INSERT INTO audit_logs (id, client_id, action, resource_type, resource_id)
         VALUES ('a1', 't1', 'lamp.extinguish', 'lamp', 'o1')`,
      );

      await expect(applyAll(db)).resolves.toBeUndefined();

      // And the replay is a NO-OP, not a re-create: the row is still there.
      const { rows } = await db.query<{ id: string }>('SELECT id FROM audit_logs');
      expect(rows.map((row) => row.id)).toEqual(['a1']);
    } finally {
      await db.close();
    }
  });

  it('adopts a PRE-EXISTING audit_logs created by the host own migration', async () => {
    // The real Phase-B situation: the host created this table (with its own FK
    // into `clients`, and its own indexes) long before the package existed, and
    // the package migration sorts after it.
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE "clients" ("id" TEXT NOT NULL, CONSTRAINT "clients_pkey" PRIMARY KEY ("id"));
        CREATE TABLE "audit_logs" (
          "id" TEXT NOT NULL,
          "client_id" TEXT NOT NULL,
          "actor_user_id" TEXT,
          "actor_role" TEXT,
          "scope" TEXT,
          "on_behalf_of_user_id" TEXT,
          "action" TEXT NOT NULL,
          "resource_type" TEXT NOT NULL,
          "resource_id" TEXT NOT NULL,
          "before" JSONB NOT NULL DEFAULT '{}',
          "after" JSONB NOT NULL DEFAULT '{}',
          "request_id" TEXT,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
        );
        CREATE INDEX "audit_logs_client_id_created_at_idx" ON "audit_logs"("client_id", "created_at");
        ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_client_id_fkey"
          FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        INSERT INTO "clients" ("id") VALUES ('t1');
        INSERT INTO "audit_logs" (id, client_id, action, resource_type, resource_id)
          VALUES ('legacy', 't1', 'lamp.extinguish', 'lamp', 'o1');
      `);

      await expect(applyAll(db)).resolves.toBeUndefined();

      // The host's own history survives, its FK survives, and the indexes the
      // package needs are now there.
      const { rows } = await db.query<{ id: string }>('SELECT id FROM audit_logs');
      expect(rows.map((row) => row.id)).toEqual(['legacy']);
      const { rows: fks } = await db.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conname = 'audit_logs_client_id_fkey'`,
      );
      expect(fks).toHaveLength(1);
      const { rows: indexes } = await db.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs'",
      );
      expect(indexes.map((row) => row.indexname)).toContain(
        'audit_logs_client_id_action_resource_type_created_at_idx',
      );
    } finally {
      await db.close();
    }
  });

  it('adds the impersonation column to a table that predates it', async () => {
    // The other pre-existing shape: an audit table from before the pair existed.
    // The CREATE is a no-op for it, so the column has to arrive by its own
    // ADD COLUMN — otherwise every write of the pair fails at runtime, which is a
    // far worse failure than a red migration.
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE "audit_logs" (
          "id" TEXT NOT NULL,
          "client_id" TEXT NOT NULL,
          "actor_user_id" TEXT,
          "actor_role" TEXT,
          "scope" TEXT,
          "action" TEXT NOT NULL,
          "resource_type" TEXT NOT NULL,
          "resource_id" TEXT NOT NULL,
          "before" JSONB NOT NULL DEFAULT '{}',
          "after" JSONB NOT NULL DEFAULT '{}',
          "request_id" TEXT,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
        );
      `);

      await applyAll(db);

      expect(await columnsOf(db)).toEqual([...COLUMNS].sort());
      await expect(
        db.query(
          `INSERT INTO audit_logs (id, client_id, action, resource_type, resource_id,
             actor_user_id, on_behalf_of_user_id)
           VALUES ('a1', 't1', 'lamp.extinguish', 'lamp', 'o1', 'u-real', 'u-subject')`,
        ),
      ).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });

  it('states its idempotence in the SQL itself, not only in behaviour', () => {
    // Belt and braces: behaviour above, and the shape here — so a rewrite that
    // happens to pass on today's fixtures but drops an `IF NOT EXISTS` fails.
    //
    // Comment lines are stripped first: the migration's own deploy runbook quotes
    // a `CREATE INDEX CONCURRENTLY` a DBA runs out of band, and counting that as a
    // statement would make the assertion pass or fail on prose.
    const sql = migrations()
      .map(sqlOf)
      .join('\n')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "audit_logs"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "on_behalf_of_user_id"/);
    const creates = sql.match(/CREATE (TABLE|INDEX)/g) ?? [];
    const guarded = sql.match(/CREATE (TABLE|INDEX) IF NOT EXISTS/g) ?? [];
    // Every DDL statement in the folder is guarded — not just the ones the cases
    // above happen to exercise.
    expect({ creates: creates.length, guarded: guarded.length }).toEqual({
      creates: 6,
      guarded: 6,
    });
  });
});
