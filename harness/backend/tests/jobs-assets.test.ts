/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject here. This asserts that the
   migrations inside the PUBLISHED tarball apply to a real Postgres; mocking
   either would leave the suite checking a fixture instead of the artifact, which
   is the one thing it exists to check. Every path read is inside the installed
   package and the database is a fresh in-process PGlite per test. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/jobs owns the `SweepLease` model — the single-writer lease its
 * sweep helper claims — so it ships the model partial AND the migration, and
 * the host copies both (`prisma` is in the package's `files` for exactly this).
 *
 * Same two silent failure modes the payments assets test guards: the
 * migrations can be missing from the tarball (the host's `migrate deploy`
 * finds nothing, reports success and creates no table), or present but not
 * apply. PGlite is a real Postgres, so "does this SQL apply" is answered by
 * running it.
 */
const jobsPackage = fileURLToPath(new URL('../node_modules/@12-apps/jobs/', import.meta.url));
const migrationsDir = join(jobsPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('@12-apps/jobs — the prisma assets survive publication', () => {
  it('ships its schema partial', () => {
    const partial = readFileSync(join(jobsPackage, 'prisma/jobs.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+SweepLease/);
  });

  it('ships at least one migration', () => {
    // Zero would make the apply test below vacuously green — the exact shape of
    // the failure this file exists to catch.
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

  it('creates the sweep_leases table the lease claims against', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      const { rows } = await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'sweep_leases' ORDER BY column_name",
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        'acquired_at',
        'expires_at',
        'holder',
        'name',
      ]);
    } finally {
      await db.close();
    }
  });
});
