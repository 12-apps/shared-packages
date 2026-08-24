/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-fs --
   the database and the installed tarballs ARE the subject: this suite assembles
   every published package's schema out of node_modules and applies every one of
   their migrations to a real Postgres (PGlite). */
/**
 * Every exported package's tables, in ONE database, read by a REAL client.
 *
 * The other suites here each prove one package's surface answers correctly over
 * a store the harness fills with hand-written SQL. This one proves the two
 * artifacts a package SHIPS agree with each other — its `migration.sql` and its
 * `.prisma` partial — which is a question no single package can ask itself.
 *
 * A package generates its client against its own partial, in a database its own
 * migration built; the two are consistent by construction there whether or not
 * they describe the same thing. The disagreement only becomes visible where one
 * tool reads both, over a schema assembled from every package at once, which is
 * what a host actually has. See `prisma/README.md`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyPackageMigrations,
  createPrismaDatabase,
  declaredModels,
  orderedMigrations,
  schemaPackages,
  type HarnessPrismaClient,
} from '../src/prisma';

let db: Awaited<ReturnType<typeof createPrismaDatabase>>;
let prisma: HarnessPrismaClient;

beforeAll(async () => {
  db = await createPrismaDatabase();
  prisma = db.prisma;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

/** Table names the database actually has, in the schema Prisma writes to. */
async function tablesInDatabase(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  return new Set(rows.map((row) => row.table_name));
}

/** Prisma's delegate name for a model: the model name, first letter lowercased. */
function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

describe('the assembled schema', () => {
  it('draws models from every installed package that ships a prisma directory', () => {
    const packages = schemaPackages();

    // A floor rather than an exact list. The set grows whenever a package starts
    // shipping models, and a test that had to be edited for that would be edited
    // without thought — while the direction that matters is a package DROPPING
    // out, which this catches.
    expect(packages.length).toBeGreaterThanOrEqual(10);

    // Both halves, from every one of them. Either alone is a packaging bug a
    // consumer discovers and the owning repo cannot: models with no migrations
    // generate a client for tables nothing creates, and the reverse creates
    // tables no client can read.
    for (const pkg of packages) {
      expect.soft(pkg.partials, `${pkg.packageName} ships no *.prisma partial`).not.toHaveLength(0);
      expect.soft(pkg.migrations, `${pkg.packageName} ships no migrations`).not.toHaveLength(0);
    }
  });

  it('applies every package migration in one deterministic order', () => {
    const migrations = orderedMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(20);

    // The order is a pure function of the directory names, so it is the same on
    // every machine and in every job. Asserting it directly is what keeps a
    // future change to the sort — say, grouping per package to dodge a collision
    // — from silently making the harness disagree with what a host applies.
    const sorted = [...migrations].sort(
      (a, b) => a.dir.localeCompare(b.dir) || a.package.localeCompare(b.package),
    );
    expect(migrations.map((m) => `${m.dir}:${m.package}`)).toEqual(
      sorted.map((m) => `${m.dir}:${m.package}`),
    );
  });

  it('applies cleanly into a database that has nothing yet', async () => {
    // A second, independent database. `createPrismaDatabase` already did this
    // once in `beforeAll`, but that one is shared with every case below — and
    // the property here is specifically that the whole set applies from EMPTY,
    // which a database somebody else has already touched cannot demonstrate.
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = new PGlite();
    await pg.waitReady;
    await expect(applyPackageMigrations(pg)).resolves.toBeUndefined();
    await pg.close();
  }, 180_000);
});

describe('each partial against its own migration', () => {
  /**
   * The suite's reason to exist: every model the packages describe has to be a
   * table the packages create.
   *
   * A drifted `@@map`, a model added to a partial without a migration, or a
   * migration renamed without its partial all land here — and nowhere else,
   * because every other reader of these packages opens exactly one of the two
   * files.
   */
  it('creates a table for every model every partial declares', async () => {
    const tables = await tablesInDatabase();
    const models = declaredModels();
    expect(models.length).toBeGreaterThanOrEqual(30);

    // Reported as `package model -> table`, so a failure names the tarball to
    // open rather than only the model that is missing one.
    const missing = models
      .filter((model) => !tables.has(model.table))
      .map((model) => `${model.package} ${model.model} -> ${model.table}`);
    expect(missing).toEqual([]);
  });

  /**
   * The same question one level down, where the drift is quieter.
   *
   * A table can exist and still be the wrong shape: a column renamed in the
   * migration but not in the partial reads as "no such column" only when some
   * query happens to select it. Asking the generated client for one row of every
   * model puts every scalar column of every model into one SELECT.
   *
   * This is also what proves the generated CLIENT is real — a delegate missing
   * here means the partial never reached `prisma/schema`, which is the failure
   * mode a silently-smaller assembly would otherwise produce.
   */
  it('selects a row from every model without a column error', async () => {
    const failures: string[] = [];
    for (const model of declaredModels()) {
      const delegate = prisma[lowerFirst(model.model)] as
        | { findFirst: () => Promise<unknown> }
        | undefined;
      if (typeof delegate?.findFirst !== 'function') {
        failures.push(`${model.package}  ${model.model}: no delegate on the generated client`);
        continue;
      }
      try {
        await delegate.findFirst();
      } catch (error) {
        failures.push(`${model.package}  ${model.model}: ${String(error).split('\n')[0]}`);
      }
    }
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  }, 180_000);
});
