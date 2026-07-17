/**
 * Provision a PGlite database for local dev / Playwright e2e: replay every
 * committed Prisma migration, then run the idempotent seed.
 *
 * The community `pglite-prisma-adapter` is Prisma-Client-only (it does not
 * support `prisma migrate`), so the schema is applied by replaying the
 * already-committed `migration.sql` files straight into PGlite — the same
 * approach the integration suite uses. One process owns the dataDir for the
 * whole run, then exits, releasing the OS file lock before the web server opens
 * the same directory.
 *
 *   PGLITE_DATA_DIR=./.e2e-db pnpm --filter @12-apps/shared-helpers exec tsx prisma/pglite-setup.ts
 *   # or, via the package script:
 *   PGLITE_DATA_DIR=./.e2e-db pnpm --filter @12-apps/shared-helpers db:pglite:setup
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { applyAuditStamps } from '../src/prisma/audit-extension';
import { seed } from './seed';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');

/** Replay every committed migration's SQL into PGlite, in timestamp order. */
const applyMigrations = async (db: PGlite): Promise<void> => {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
    await db.exec(sql);
  }
};

const main = async (): Promise<void> => {
  const dataDir = process.env.PGLITE_DATA_DIR; // undefined ⇒ in-memory
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;

  await applyMigrations(db);

  // Build a PGlite-backed Prisma client on the SAME instance and seed it.
  // `pglite-prisma-adapter` is `exports`-only; type the dynamic import locally
  // so this script needs no static type dependency on the package.
  const { PrismaPGlite } = (await import('pglite-prisma-adapter')) as unknown as {
    PrismaPGlite: new (client: unknown) => unknown;
  };
  const { PrismaClient } = await import('@prisma/client');
  // Wrap with the audit extension so seed writes maintain `search_name` (FUT-168)
  // exactly like the app runtime — otherwise seeded rows would be unsearchable by
  // the accent-insensitive key. createdBy/updatedBy stay null (no seed actor).
  const prisma = applyAuditStamps(
    new PrismaClient({
      adapter: new PrismaPGlite(db) as Prisma.PrismaClientOptions['adapter'],
    }),
  );

  await seed(prisma);
  await prisma.$disconnect();
  // The adapter may already have closed the underlying PGlite on $disconnect.
  await db.close().catch(() => undefined);

  console.error(
    `PGlite provisioned${dataDir ? ` at ${dataDir}` : ' (in-memory)'}`,
  );
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
