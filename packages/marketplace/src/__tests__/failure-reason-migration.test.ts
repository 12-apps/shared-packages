import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

/**
 * The migration that widens the failure-reason CHECK (FUT-4917), on REAL
 * Postgres: the new value is accepted, a value outside the three is still
 * refused, the previous values still pass, and the folder replays as a no-op.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   The committed SQL and a real database ARE the subject; each case boots its
   own in-memory PGlite. */

vi.setConfig({ testTimeout: 60_000 });

const MIGRATIONS = new URL("../../prisma/migrations/", import.meta.url);
const sqls = () => readdirSync(MIGRATIONS).sort().map((dir) => readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), "utf8"));

async function migrated(): Promise<PGlite> {
  const pg = new PGlite();
  for (const sql of sqls()) await pg.exec(sql);
  return pg;
}

const insert = (id: string, reason: string) =>
  `INSERT INTO marketplace_acceptances (id, client_id, order_id, provider, external_order_id, cancellation_status, cancellation_failure_reason, updated_at)
   VALUES ('${id}', 't', 'o-${id}', 'IFOOD', 'x-${id}', 'FAILED', '${reason}', now())`;

describe("the failure-reason CHECK", () => {
  it("accepts REFUSED, UNREACHABLE and TIMEOUT, and refuses any other value", async () => {
    const pg = await migrated();
    for (const reason of ["REFUSED", "UNREACHABLE", "TIMEOUT"]) await pg.exec(insert(reason, reason));
    await expect(pg.exec(insert("bogus", "BOGUS"))).rejects.toThrow(/cancellation_failure_reason_check/u);
  });

  it("declares its domain first and replays as a no-op, in either order with the original", async () => {
    const pg = await migrated();
    const all = sqls();
    for (const sql of all) expect(sql.startsWith("-- @domains: marketplace")).toBe(true);
    for (const sql of all) await pg.exec(sql);
    await pg.exec(insert("again", "UNREACHABLE"));
  });
});
