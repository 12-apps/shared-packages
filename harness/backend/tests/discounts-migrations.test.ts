/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migration inside the PUBLISHED @12-apps/discounts tarball applies to a real
   Postgres. Every path read is inside the installed package and the database is
   a fresh in-process PGlite per test. */
/**
 * `@12-apps/discounts` ships its three models AND their migration, and a host
 * applies them — the same contract `migrations.test.ts` pins for
 * payments-backend, asserted against the discounts tarball.
 *
 * The REPLAY case is the one that matters here and it is not ceremony. This
 * package's migration is written to ADOPT an existing `discounts` table rather
 * than demand a baseline, because the first host to adopt it already had one
 * from its own earlier migration — and a package migration sorts by name, so
 * it lands AFTER the host's. A bare `CREATE TABLE` would fail
 * `prisma migrate deploy` on that database and on a fresh one built from the
 * full folder, and `prisma migrate resolve --applied` can only paper over the
 * first case, by hand, once per database.
 *
 * So "applies twice with no error" is the property the design is FOR, and the
 * only place it can be observed is a host that applies the shipped file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDiscountMigrations } from '../src/discounts-db';

const discountsPackage = fileURLToPath(
  new URL('../node_modules/@12-apps/discounts/', import.meta.url),
);
const migrationsDir = join(discountsPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const DISCOUNT_TABLES = ['discounts', 'discount_combo_slots', 'discount_targets'];

async function tables(pg: PGlite): Promise<Set<string>> {
  const result = await pg.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  return new Set(result.rows.map((row) => row.table_name));
}

describe('@12-apps/discounts — the prisma assets survive publication', () => {
  it('publishes the partial and at least one migration', () => {
    expect(existsSync(join(discountsPackage, 'prisma/discounts.prisma'))).toBe(true);
    expect(migrations().length).toBeGreaterThan(0);
    for (const name of migrations()) {
      const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
      expect(sql.trim().length, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await expect(applyDiscountMigrations(pg)).resolves.toBeUndefined();
    const present = await tables(pg);
    for (const table of DISCOUNT_TABLES) expect(present.has(table), `${table} missing`).toBe(true);
    await pg.close();
  }, 60_000);

  it('replays over a database that already has the tables', async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await applyDiscountMigrations(pg);
    // The property the whole file is written for. Not a no-op check for its own
    // sake: an adopter's `migrate deploy` runs this file against a database its
    // own earlier migration already shaped.
    await expect(applyDiscountMigrations(pg)).resolves.toBeUndefined();
    await pg.close();
  }, 60_000);

  it('adopts a host `discounts` table that predates the package', async () => {
    const pg = new PGlite();
    await pg.waitReady;
    // The ORIGIN host's shape, near enough: the columns that existed before the
    // combo half landed. The package must add what is missing rather than
    // refuse the table.
    await pg.exec(`
      CREATE TABLE "discounts" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "client_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "percent_off_bp" INTEGER,
        "amount_off_cents" INTEGER,
        "scope" TEXT NOT NULL,
        "trigger" TEXT NOT NULL,
        "code" TEXT,
        "starts_at" TIMESTAMP(3),
        "ends_at" TIMESTAMP(3),
        "min_subtotal_cents" INTEGER,
        "usage_limit" INTEGER,
        "per_buyer_limit" INTEGER,
        "usage_count" INTEGER NOT NULL DEFAULT 0,
        "stackable" BOOLEAN NOT NULL DEFAULT true,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "archived_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL
      );
    `);

    await expect(applyDiscountMigrations(pg)).resolves.toBeUndefined();

    // The three combo columns arrived on the existing table…
    const columns = await pg.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'discounts'",
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const added of ['bundle_price_cents', 'free_units', 'max_combo_applications']) {
      expect(names.has(added), `${added} was not added to the adopted table`).toBe(true);
    }
    // …and the two tables the host never had were created outright.
    const present = await tables(pg);
    expect(present.has('discount_combo_slots')).toBe(true);
    expect(present.has('discount_targets')).toBe(true);

    await pg.close();
  }, 60_000);
});
