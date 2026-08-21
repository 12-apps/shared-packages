import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../prisma/migrations');

/** Every plugin-owned migration, in the order the host applies them. */
async function applyMigrations(target: PGlite): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  expect(dirs.length).toBeGreaterThan(0);
  for (const dir of dirs) {
    await target.exec(await readFile(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
  }
}

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "clients" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "users" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "resource_assignments" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "client_id" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
      "resource_type" TEXT NOT NULL,
      "resource_id" TEXT NOT NULL,
      "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "valid_to" TIMESTAMP(3)
    );
    CREATE UNIQUE INDEX "resource_assignments_active_unique_idx"
      ON "resource_assignments"("user_id", "client_id", "resource_type", "resource_id")
      WHERE "valid_to" IS NULL;
  `);
  await applyMigrations(db);
  await db.exec(`
    INSERT INTO "clients" ("id") VALUES ('tenant-a');
    INSERT INTO "users" ("id") VALUES ('tech-a'), ('tech-b');
    INSERT INTO "resource_assignments"
      ("id", "user_id", "client_id", "resource_type", "resource_id")
    VALUES
      ('assignment-a', 'tech-a', 'tenant-a', 'tower', 'tower-14'),
      ('assignment-b', 'tech-b', 'tenant-a', 'tower', 'tower-14');
  `);
});

afterEach(async () => {
  await db.close();
});

describe('shift PostgreSQL schema', () => {
  it('enforces one open shift per tenant/user while allowing historical shifts', async () => {
    await db.exec(`
      INSERT INTO "shifts"
        ("id", "client_id", "user_id", "kind", "started_at")
      VALUES ('shift-a', 'tenant-a', 'tech-a', 'climb', CURRENT_TIMESTAMP);
    `);
    await expect(
      db.exec(`
        INSERT INTO "shifts"
          ("id", "client_id", "user_id", "kind", "started_at")
        VALUES ('shift-b', 'tenant-a', 'tech-a', 'climb', CURRENT_TIMESTAMP);
      `),
    ).rejects.toThrow(/shifts_open_client_user_key/);
    await db.exec(`
      UPDATE "shifts"
         SET "ended_at" = CURRENT_TIMESTAMP,
             "ended_reason" = 'user',
             "ended_by_user_id" = 'tech-a'
       WHERE "id" = 'shift-a';
      INSERT INTO "shifts"
        ("id", "client_id", "user_id", "kind", "started_at")
      VALUES ('shift-b', 'tenant-a', 'tech-a', 'climb', CURRENT_TIMESTAMP);
    `);
  });

  it('lets multiple workers share a resource but one assignment belong to one shift', async () => {
    await db.exec(`
      INSERT INTO "shifts"
        ("id", "client_id", "user_id", "kind", "started_at",
         "resource_assignment_id", "resource_type", "resource_id")
      VALUES
        ('shift-a', 'tenant-a', 'tech-a', 'climb', CURRENT_TIMESTAMP,
         'assignment-a', 'tower', 'tower-14'),
        ('shift-b', 'tenant-a', 'tech-b', 'climb', CURRENT_TIMESTAMP,
         'assignment-b', 'tower', 'tower-14');
    `);
    await db.exec(`
      UPDATE "shifts"
         SET "ended_at" = CURRENT_TIMESTAMP,
             "ended_reason" = 'user',
             "ended_by_user_id" = 'tech-b'
       WHERE "id" = 'shift-b';
    `);
    await expect(
      db.exec(`
        INSERT INTO "shifts"
          ("id", "client_id", "user_id", "kind", "started_at",
           "resource_assignment_id", "resource_type", "resource_id")
        VALUES
          ('shift-c', 'tenant-a', 'tech-b', 'climb', CURRENT_TIMESTAMP,
           'assignment-a', 'tower', 'tower-14');
      `),
    ).rejects.toThrow(/shifts_resource_assignment_id_key/);
  });

  it('accepts any host kind, and still requires one', async () => {
    // The column carries HOST vocabulary. `shifts_kind_check` used to restrict
    // it to two values from the application this package was extracted from,
    // which no adopter could configure their way out of — a migration replaced
    // it with the guarantee the package actually owns.
    await db.exec(`
      INSERT INTO "shifts"
        ("id", "client_id", "user_id", "kind", "started_at")
      VALUES
        ('shift-a', 'tenant-a', 'tech-a', 'climb', CURRENT_TIMESTAMP),
        ('shift-b', 'tenant-a', 'tech-b', 'hygiene', CURRENT_TIMESTAMP);
    `);
    await expect(
      db.exec(`
        INSERT INTO "shifts"
          ("id", "client_id", "user_id", "kind", "started_at")
        VALUES ('bad', 'tenant-a', 'tech-c', '  ', CURRENT_TIMESTAMP);
      `),
    ).rejects.toThrow(/shifts_kind_present_check/);
  });

  it('has no constraint left that names a kind', async () => {
    // The regression guard for the drop: a CHECK holding a kind literal is the
    // one form of this leak an adopter cannot configure, lint or type away.
    const result = await db.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid = '"shifts"'::regclass AND contype = 'c';
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    const kindChecks = result.rows
      .map(({ definition }) => definition)
      .filter((definition) => /\bkind\b/.test(definition));
    expect(kindChecks).toEqual(['CHECK ((btrim(kind) <> \'\'::text))']);
  });

  it('does not add a global active client/user/resource-type uniqueness index', async () => {
    const result = await db.query<{ indexdef: string }>(`
      SELECT indexdef
        FROM pg_indexes
       WHERE tablename = 'resource_assignments'
    `);
    const activeUnique = result.rows
      .map((row) => row.indexdef)
      .filter((definition) => /UNIQUE.*WHERE.*valid_to IS NULL/i.test(definition));
    expect(activeUnique).not.toHaveLength(0);
    expect(activeUnique.every((definition) => definition.includes('resource_id'))).toBe(true);
    expect(activeUnique.join('\n')).not.toMatch(
      /UNIQUE.*(?:client_id.*user_id|user_id.*client_id).*resource_type\W*\).*WHERE/i,
    );
  });

  it('defaults tenant auto-close configuration to 16 hours', async () => {
    await db.exec(`
      INSERT INTO "shift_tenant_configs" ("client_id") VALUES ('tenant-a');
    `);
    const result = await db.query<{ auto_close_hours: number }>(`
      SELECT "auto_close_hours" FROM "shift_tenant_configs" WHERE "client_id" = 'tenant-a'
    `);
    expect(result.rows[0]?.auto_close_hours).toBe(16);
  });

  it('keeps a closed shift immutable under UPDATE', async () => {
    await db.exec(`
      INSERT INTO "shifts"
        ("id", "client_id", "user_id", "kind", "started_at",
         "ended_at", "ended_reason", "ended_by_user_id")
      VALUES
        ('shift-a', 'tenant-a', 'tech-a', 'climb',
         '2026-07-30T10:00:00Z', '2026-07-30T18:00:00Z', 'user', 'tech-a');
    `);

    await expect(
      db.exec(`UPDATE "shifts" SET "kind" = 'dispatch' WHERE "id" = 'shift-a'`),
    ).rejects.toThrow(/closed shifts are immutable/i);
  });

  it('keeps an open shift identity immutable under UPDATE', async () => {
    await db.exec(`
      INSERT INTO "shifts" ("id", "client_id", "user_id", "kind", "started_at")
      VALUES ('shift-a', 'tenant-a', 'tech-a', 'climb', CURRENT_TIMESTAMP);
    `);

    await expect(
      db.exec(`UPDATE "shifts" SET "user_id" = 'tech-b' WHERE "id" = 'shift-a'`),
    ).rejects.toThrow(/identity and resource snapshots are immutable/i);
    // Closing it — the one edit the service performs — still works.
    await db.exec(`
      UPDATE "shifts"
         SET "ended_at" = CURRENT_TIMESTAMP,
             "ended_reason" = 'user',
             "ended_by_user_id" = 'tech-a'
       WHERE "id" = 'shift-a';
    `);
  });

  it('permits DELETE, so a host can purge a tenant it stores only by value', async () => {
    // `client_id` carries no FK (that is what makes the package host-agnostic),
    // so a host purging a tenant deletes the tenant row and then sweeps the
    // by-value tables. A trigger that raised on DELETE aborted that sweep —
    // and the origin host runs it on every deploy for the demo stores.
    await db.exec(`
      INSERT INTO "shifts"
        ("id", "client_id", "user_id", "kind", "started_at",
         "ended_at", "ended_reason", "ended_by_user_id")
      VALUES
        ('closed', 'tenant-a', 'tech-a', 'climb',
         '2026-07-30T10:00:00Z', '2026-07-30T18:00:00Z', 'user', 'tech-a');
      INSERT INTO "shifts" ("id", "client_id", "user_id", "kind", "started_at")
      VALUES ('open', 'tenant-a', 'tech-b', 'climb', CURRENT_TIMESTAMP);
    `);

    await db.exec(`DELETE FROM "shifts" WHERE "client_id" = 'tenant-a'`);

    const rows = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "shifts"`,
    );
    expect(rows.rows[0]?.count).toBe('0');
  });

  it('does not touch a host roles table (RBAC backfill is host-owned)', async () => {
    const sources = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
    for (const entry of sources.filter((row) => row.isDirectory())) {
      const source = await readFile(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8');
      expect(source).not.toMatch(/UPDATE\s+"roles"/i);
      // A plugin migration may not name a host table it does not own.
      expect(source).not.toMatch(/"clients"/i);
    }
  });
});
