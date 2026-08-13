/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migrations inside the PUBLISHED @12-apps/entity-lifecycle tarball apply to
   a real Postgres. Every path read is inside the installed package and the
   database is a fresh in-process PGlite per test. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/entity-lifecycle ships its four models AND their migrations
 * (12-17), and a host applies them — the same contract `rbac-migrations`
 * pins for the rbac tarball: present in the package, non-empty, appliable in
 * order, and actually creating the tables the seam reads, with the closed-set
 * CHECKs and the one-OPEN-draft partial unique index enforced by the schema
 * rather than by hope.
 */
const lifecyclePackage = fileURLToPath(
  new URL('../node_modules/@12-apps/entity-lifecycle/', import.meta.url),
);
const migrationsDir = join(lifecyclePackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const LIFECYCLE_TABLES = [
  'entity_versions',
  'recycle_bin_entries',
  'entity_drafts',
  'change_requests',
];

describe('@12-apps/entity-lifecycle — the prisma assets survive publication', () => {
  it('ships its schema partial with all four models', () => {
    const partial = readFileSync(
      join(lifecyclePackage, 'prisma/entity-lifecycle.prisma'),
      'utf-8',
    );
    for (const model of ['EntityVersion', 'RecycleBinEntry', 'EntityDraft', 'ChangeRequest']) {
      expect(partial).toMatch(new RegExp(`model\\s+${model}\\s`));
    }
  });

  it('ships at least one non-empty migration', () => {
    const names = migrations();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
      expect(sql.trim().length).toBeGreaterThan(0);
    }
  });

  it('applies in order onto a fresh Postgres and creates the four tables', async () => {
    const pg = new PGlite();
    try {
      for (const name of migrations()) {
        await pg.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      const { rows } = await pg.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tables = rows.map((row) => row.table_name);
      for (const table of LIFECYCLE_TABLES) {
        expect(tables).toContain(table);
      }
    } finally {
      await pg.close();
    }
  });

  it('enforces the one-OPEN-draft partial unique index and the closed status sets', async () => {
    const pg = new PGlite();
    try {
      for (const name of migrations()) {
        await pg.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      await pg.query(
        `INSERT INTO entity_drafts (id, client_id, entity_type, entity_id, data, updated_at)
         VALUES ('d1', 't1', 'product', 'p1', '{}'::jsonb, NOW())`,
      );
      // A second OPEN draft for the same entity violates the partial index…
      await expect(
        pg.query(
          `INSERT INTO entity_drafts (id, client_id, entity_type, entity_id, data, updated_at)
           VALUES ('d2', 't1', 'product', 'p1', '{}'::jsonb, NOW())`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      // …but a DISCARDED sibling and a second NEW-item (NULL id) draft do not.
      await pg.query(
        `INSERT INTO entity_drafts (id, client_id, entity_type, entity_id, data, status, updated_at)
         VALUES ('d3', 't1', 'product', 'p1', '{}'::jsonb, 'DISCARDED', NOW())`,
      );
      await pg.query(
        `INSERT INTO entity_drafts (id, client_id, entity_type, entity_id, data, updated_at)
         VALUES ('d4', 't1', 'product', NULL, '{}'::jsonb, NOW()),
                ('d5', 't1', 'product', NULL, '{}'::jsonb, NOW())`,
      );
      // The library's closed sets are CHECKed by the schema itself.
      await expect(
        pg.query(
          `INSERT INTO entity_versions
             (id, client_id, entity_type, entity_id, version, kind, is_snapshot, data)
           VALUES ('v1', 't1', 'product', 'p1', 1, 'SIDEWAYS', TRUE, '{}'::jsonb)`,
        ),
      ).rejects.toThrow(/check/i);
      await expect(
        pg.query(
          `INSERT INTO change_requests (id, client_id, entity_type, action, payload, status)
           VALUES ('c1', 't1', 'product', 'UPDATE', '{}'::jsonb, 'MAYBE')`,
        ),
      ).rejects.toThrow(/check/i);
    } finally {
      await pg.close();
    }
  });
});
