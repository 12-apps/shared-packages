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
 * A package that owns Prisma models ships the models AND their migrations, and
 * the host applies them — @12-apps/payments-backend lists `prisma` in its
 * `files` for exactly that reason. Nothing else in CI opens that folder.
 *
 * Two ways it goes wrong, both silent. The migrations can be missing from the
 * tarball, in which case the host's `prisma migrate deploy` finds nothing,
 * reports success and creates no tables. Or they can be present but not apply,
 * which the host discovers during a deploy rather than here.
 *
 * PGlite is a real Postgres, so "does this SQL apply" is answered by running it
 * — no Prisma client generation, no schema stitching, no container.
 */
// Located by path rather than by `require.resolve('<pkg>/package.json')`,
// because none of these packages export `./package.json` — that idiom throws
// ERR_PACKAGE_PATH_NOT_EXPORTED against them today. Reading the installed
// directory directly is also the more honest question: these files are shipped
// ASSETS, not module entry points, and a host copies them with a script rather
// than importing them.
const paymentsBackend = fileURLToPath(
  new URL('../node_modules/@12-apps/payments-backend/', import.meta.url),
);
const migrationsDir = join(paymentsBackend, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('@12-apps/payments-backend — the prisma assets survive publication', () => {
  it('ships its schema partial', () => {
    // The host stitches this into its own schema; absent, the models the store
    // queries simply do not exist.
    const partial = readFileSync(join(paymentsBackend, 'prisma/payments.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+\w+/);
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
        // Named in the failure so a broken migration identifies itself rather
        // than reporting as "the payments migrations do not apply".
        await expect(db.exec(sql), `migration ${name}`).resolves.toBeDefined();
      }
    } finally {
      await db.close();
    }
  });

  it('creates the tables the config store reads', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
      }
      const { rows } = await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      // Applying cleanly and creating nothing is a real outcome — a migration
      // set that only ALTERs, or one whose statements were all no-ops, leaves a
      // green apply and an empty database.
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
});
