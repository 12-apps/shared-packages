/**
 * A REAL Prisma client over the harness database.
 *
 * Every other db seam in `src/` is hand-written SQL, and that is deliberate:
 * the packages declare their stores structurally (`RbacDb`, `AuditDb`,
 * `SavedReportDb`), so filling one with SQL proves the routes cannot tell what
 * is underneath. This module is the other half of the same claim, and the one
 * the SQL delegates cannot make.
 *
 * ## What only a real client can answer
 *
 * A package's partial is a promise about the SHAPE its models take in a
 * consumer's client: this column is optional, that one is a `Json`, this pair
 * is a composite unique, that relation is named. Hand-written SQL never reads
 * the partial at all, so a partial that disagrees with its own migration —
 * a renamed `@map`, a nullability that moved, a `@@unique` the migration never
 * created — is invisible to every suite in this directory.
 *
 * Prisma reads BOTH. Generating a client from the assembled partials and then
 * running it against the replayed migrations puts the two artifacts each package
 * ships into contact, which is exactly where a plug-and-play schema breaks and
 * exactly what no single package's own tests can cover: each of them generates
 * against its own partial alone, in a database only its own migration built.
 *
 * ## The adapter, and why `migrate` never runs
 *
 * `pglite-prisma-adapter` is Prisma-Client only. That costs nothing here,
 * because a host does not `migrate` a plugin's tables — it APPLIES the
 * migrations the plugin ships, which is what `applyPackageMigrations` does. See
 * `prisma.config.ts` for the longer version.
 */
import type { PGlite } from '@electric-sql/pglite';

import {
  declaredModels,
  migrationStatements,
  orderedMigrations,
  schemaPackages,
} from '../prisma/packages';

export { declaredModels, orderedMigrations, schemaPackages };

/**
 * The generated client's constructor and its option bag.
 *
 * Typed locally and imported dynamically for one reason: `@prisma/client` has
 * no types until `prisma generate` has run over an ASSEMBLED schema folder, and
 * the folder is assembled from `node_modules` at install time. A static import
 * would make every file that transitively reaches this one fail to typecheck on
 * a tree where the harness has not been installed yet — including
 * `scripts/harness-install.mjs`'s own repo.
 */
interface PrismaModule {
  PrismaClient: new (options: { adapter: unknown }) => HarnessPrismaClient;
}

/**
 * What this module promises about the client it returns.
 *
 * Deliberately narrow. A suite that wants a model delegate reaches for it by
 * name off the returned object and gets the generated types from
 * `@prisma/client` at its own import site; what belongs HERE is only the
 * lifecycle every caller needs.
 */
export interface HarnessPrismaClient {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $disconnect: () => Promise<void>;
  [delegate: string]: unknown;
}

/**
 * Replay every installed package's migrations into `pg`, in a host's order.
 *
 * One call per DATABASE, not per package: the ordering across packages is a
 * property of the whole set (see `orderedMigrations`), and a per-package entry
 * point invites a caller to apply four of the sixteen and get a database that
 * looks fine until the fifth package's endpoint is asked for something.
 *
 * A failing migration names its OWNING PACKAGE, because that is the actionable
 * fact. `20260813120000_add_entity_lifecycle_tables` says nothing about which
 * tarball to look in, and the migration that fails is routinely not the one at
 * fault — a package whose DDL collides with an earlier package's is discovered
 * through the second one's failure.
 */
export async function applyPackageMigrations(pg: PGlite): Promise<void> {
  for (const migration of migrationStatements()) {
    try {
      await pg.exec(migration.sql);
    } catch (cause) {
      throw new Error(
        `${migration.package} migration ${migration.dir} failed to apply: ${String(cause)}`,
        { cause },
      );
    }
  }
}

/**
 * A Prisma client bound to an ALREADY-MIGRATED PGlite.
 *
 * Takes the instance rather than opening one so a suite can hold both handles:
 * the SQL seams and the client must address the same database or an assertion
 * about what a write landed proves nothing.
 */
export async function createPrismaClient(pg: PGlite): Promise<HarnessPrismaClient> {
  const { PrismaPGlite } = (await import('pglite-prisma-adapter')) as unknown as {
    PrismaPGlite: new (client: PGlite) => unknown;
  };
  const { PrismaClient } = (await import('@prisma/client')) as unknown as PrismaModule;
  return new PrismaClient({ adapter: new PrismaPGlite(pg) });
}

/**
 * A fresh in-memory database carrying every package's tables, and a client on it.
 *
 * The whole provisioning a suite needs in one call. In-memory rather than
 * file-backed: nothing here outlives the suite, and a data directory is a lock
 * two parallel suites can contend for.
 */
export async function createPrismaDatabase(): Promise<{
  pg: PGlite;
  prisma: HarnessPrismaClient;
  close: () => Promise<void>;
}> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.waitReady;
  await applyPackageMigrations(pg);
  const prisma = await createPrismaClient(pg);
  return {
    pg,
    prisma,
    close: async () => {
      await prisma.$disconnect();
      // The adapter may already have closed the PGlite underneath on
      // `$disconnect`; closing twice is not an error worth surfacing.
      await pg.close().catch(() => undefined);
    },
  };
}
