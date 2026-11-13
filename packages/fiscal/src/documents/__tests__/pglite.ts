import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import type { FiscalPrismaClient, FiscalSqlClient } from "../sql-store";

/**
 * A real (WASM) Postgres with the package's migrations applied, and the two
 * raw-SQL methods plus `$transaction` a Prisma client offers, over it — so the
 * package's own store runs here exactly as it runs on a host's client.
 */

const MIGRATIONS = join(import.meta.dirname, "../../../prisma/migrations");

export async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  for (const dir of readdirSync(MIGRATIONS).filter((name) => /^\d/.test(name)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8"));
  }
  return db;
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
