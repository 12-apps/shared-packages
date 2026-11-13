import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import type { FiscalPrismaClient, FiscalSqlClient } from "../../sql-store";

/**
 * A real (WASM) Postgres with the package's migrations applied, and the two
 * raw-SQL methods plus `$transaction` a Prisma client offers, over it — so the
 * package's own store runs here exactly as it runs on a host's client.
 */

const MIGRATIONS = join(import.meta.dirname, "../../../../prisma/migrations");

async function migrate(): Promise<PGlite> {
  const db = new PGlite();
  for (const dir of readdirSync(MIGRATIONS).filter((name) => /^\d/.test(name)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8"));
  }
  return db;
}

/** One migrated database per test file: starting and migrating a PGlite costs about a second each time. */
let shared: Promise<PGlite> | undefined;

/**
 * Starts and migrates the file's database once. Call it from a `beforeAll` so
 * the migration is paid under the hook's own timeout, never inside the first
 * case's.
 */
export async function warmDatabase(): Promise<void> {
  shared ??= migrate();
  await shared;
}

/**
 * The file's migrated database, emptied: every table truncated and every
 * sequence restarted, so each case starts from what a fresh migration leaves
 * (the migrations insert no rows). `close()` on the handle is a no-op; the
 * database lives as long as the file's worker.
 */
export async function migratedDatabase(): Promise<PGlite> {
  shared ??= migrate();
  const db = await shared;
  const { rows } = await db.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'");
  if (rows.length > 0) {
    await db.exec(`TRUNCATE ${rows.map(({ name }) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === "close") return async () => {};
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type Queryable = Pick<PGlite, "query">;

function sqlClient(target: Queryable): FiscalSqlClient {
  return {
    $queryRawUnsafe: async <T>(query: string, ...values: unknown[]) => (await target.query(query, values)).rows as T,
    $executeRawUnsafe: async (query: string, ...values: unknown[]) => (await target.query(query, values)).affectedRows ?? 0,
  };
}

export function prismaOver(db: PGlite): FiscalPrismaClient {
  return {
    ...sqlClient(db),
    $transaction: (run) => db.transaction((tx) => run(sqlClient(tx))),
  };
}
