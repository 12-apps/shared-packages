/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migrations inside the PUBLISHED @12-apps/rbac tarball apply to a real
   Postgres. Every path read is inside the installed package and the database
   is a fresh in-process PGlite per test. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/rbac ships its five models AND their migrations (12-13), and a
 * host applies them — the same contract `migrations.test.ts` pins for
 * payments-backend, asserted against the rbac tarball: present in the
 * package, non-empty, appliable in order, and actually creating the tables
 * the seam reads.
 */
const rbacPackage = fileURLToPath(new URL('../node_modules/@12-apps/rbac/', import.meta.url));
const migrationsDir = join(rbacPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const RBAC_TABLES = [
  'memberships',
  'roles',
  'membership_roles',
  'role_assignments',
  'resource_assignments',
];

describe('@12-apps/rbac — the prisma assets survive publication', () => {
  it('ships its schema partial with all five models', () => {
    const partial = readFileSync(join(rbacPackage, 'prisma/rbac.prisma'), 'utf-8');
    for (const model of [
      'Membership',
      'Role',
      'MembershipRole',
      'RoleAssignment',
      'ResourceAssignment',
    ]) {
      expect(partial).toMatch(new RegExp(`model\\s+${model}\\s`));
    }
  });

  it('ships the prisma:sync script the adoption contract names', () => {
    // ADOPTING.md tells a host to run the package's own sync script; a `files`
    // list that drops `scripts/` turns that instruction into MODULE_NOT_FOUND
    // on every real install (it works in a workspace, which is the trap).
    const script = readFileSync(
      join(rbacPackage, 'scripts/sync-rbac-schema.mjs'),
      'utf-8',
    );
    expect(script).toContain('rbac.prisma');
  });

  it('ships at least one migration', () => {
    expect(migrations().length).toBeGreaterThan(0);
  });

  it('gives every migration a migration.sql', () => {
    const empty = migrations().filter((name) => {
      const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
      return sql.trim().length === 0;
    });
    expect(empty).toEqual([]);
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
        await expect(db.exec(sql), `migration ${name}`).resolves.toBeDefined();
      }
    } finally {
      await db.close();
    }
  });

  it('creates the tables the seam reads, template-name uniqueness included', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      const { rows } = await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const tables = rows.map((row) => row.table_name);
      for (const table of RBAC_TABLES) expect(tables).toContain(table);

      // The partial unique index Prisma cannot express: two NULL-client
      // TEMPLATE rows may not share a name, while two tenants may.
      await db.query(
        `INSERT INTO roles (id, client_id, name, permissions, updated_at)
         VALUES ('t1', NULL, 'NETWORK_OPS', '*', NOW())`,
      );
      await expect(
        db.query(
          `INSERT INTO roles (id, client_id, name, permissions, updated_at)
           VALUES ('t2', NULL, 'NETWORK_OPS', '*', NOW())`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      await db.query(
        `INSERT INTO roles (id, client_id, name, permissions, updated_at)
         VALUES ('a1', 'tenant-a', 'CLERK', '[]', NOW()), ('b1', 'tenant-b', 'CLERK', '[]', NOW())`,
      );
    } finally {
      await db.close();
    }
  });

  it('allows at most ONE active assignment per (user, tenant, resource)', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      await db.query(
        `INSERT INTO resource_assignments (id, user_id, client_id, resource_type, resource_id)
         VALUES ('a1', 'u1', 't1', 'tables', 'mesa-1')`,
      );
      // The concurrent double-insert the partial unique index exists to stop.
      await expect(
        db.query(
          `INSERT INTO resource_assignments (id, user_id, client_id, resource_type, resource_id)
           VALUES ('a2', 'u1', 't1', 'tables', 'mesa-1')`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      // Revocation stamps valid_to; a NEW active claim is then legal again —
      // the index guards concurrency, never history.
      await db.query(`UPDATE resource_assignments SET valid_to = NOW() WHERE id = 'a1'`);
      await db.query(
        `INSERT INTO resource_assignments (id, user_id, client_id, resource_type, resource_id)
         VALUES ('a3', 'u1', 't1', 'tables', 'mesa-1')`,
      );
    } finally {
      await db.close();
    }
  });

  it('cascades a deleted role/membership through the n:m join', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      await db.exec(`
        INSERT INTO roles (id, client_id, name, permissions, updated_at)
          VALUES ('r1', 't1', 'Voluntário', '[]', NOW());
        INSERT INTO memberships (id, user_id, client_id, role, updated_at)
          VALUES ('m1', 'u1', 't1', 'CLERK', NOW());
        INSERT INTO membership_roles (id, membership_id, role_id)
          VALUES ('mr1', 'm1', 'r1');
      `);
      await db.query(`DELETE FROM roles WHERE id = 'r1'`);
      const { rows } = await db.query(`SELECT id FROM membership_roles`);
      // Never a dangling grant: the FK cascade takes the assignment with it.
      expect(rows).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
