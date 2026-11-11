import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

/**
 * The migration, applied to REAL Postgres (PGlite), in the three situations
 * it claims to handle:
 *
 *  1. a FRESH host — nothing exists, so it builds everything;
 *  2. a REPLAY — the whole folder re-applied is a no-op;
 *  3. the PREDECESSOR's host — the tables the private package created, with
 *     its foreign keys and its closed provider lists, and without the outbound
 *     columns: it must gain the columns, lose the closed lists, and keep the
 *     host's foreign keys.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation, test-flakiness/no-long-text-match --
   The committed SQL and a real database ARE the subject, for the whole file:
   a mocked read would assert against a fixture rather than the bytes a host's
   `migrate deploy` runs. Each case boots its own in-memory PGlite inside the
   case, so nothing is shared between cases. */

vi.setConfig({ testTimeout: 60_000 });

const MIGRATIONS = new URL("../../prisma/migrations/", import.meta.url);

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS)
    .sort()
    .map((dir) => readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), "utf8"));
}

async function applyAll(db: PGlite): Promise<void> {
  for (const sql of migrationSql()) await db.exec(sql);
}

async function columns(db: PGlite, table: string): Promise<string[]> {
  const result = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name",
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function constraints(db: PGlite, table: string): Promise<string[]> {
  const result = await db.query<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname",
    [table],
  );
  return result.rows.map((row) => row.conname);
}

const insertAcceptance = (provider: string, status = "AWAITING", acknowledged = "NULL") =>
  `INSERT INTO marketplace_acceptances (id, client_id, order_id, provider, external_order_id, status, acknowledged_at, updated_at)
   VALUES ('a-${provider}-${status}', 't', 'o-${provider}-${status}', '${provider}', 'x-${provider}-${status}', '${status}', ${acknowledged}, now())`;

/** The predecessor's own shape: host foreign keys, closed provider lists, no outbound columns. */
const PREDECESSOR = `
CREATE TABLE clients ("id" TEXT PRIMARY KEY);
CREATE TABLE orders ("id" TEXT PRIMARY KEY);
INSERT INTO clients VALUES ('t');
INSERT INTO orders VALUES ('o-IFOOD-AWAITING');
CREATE TABLE "marketplace_acceptances" (
  "id" TEXT NOT NULL PRIMARY KEY, "client_id" TEXT NOT NULL, "order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL, "external_order_id" TEXT NOT NULL, "external_display_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'AWAITING', "acknowledge_by" TIMESTAMP(3), "acknowledged_at" TIMESTAMP(3),
  "external_due_at" TIMESTAMP(3), "commission_cents" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;
ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_provider_valid"
  CHECK ("provider" IN ('IFOOD', 'RAPPI'));
`;

describe("the engine's migration", () => {
  it("builds every table on a fresh database, with the outbound columns", async () => {
    const db = new PGlite();
    await applyAll(db);

    expect(await columns(db, "marketplace_acceptances")).toEqual(
      expect.arrayContaining([
        "confirmed_at",
        "confirm_failed_at",
        "cancellation_status",
        "cancellation_reason_code",
        "delivered_by",
      ]),
    );
    for (const table of ["marketplace_integrations", "marketplace_menu_links", "marketplace_inbox_events"]) {
      expect((await columns(db, table)).length).toBeGreaterThan(0);
    }
    await db.close();
  });

  it("is a no-op when replayed", async () => {
    const db = new PGlite();
    await applyAll(db);
    const before = await constraints(db, "marketplace_acceptances");

    await expect(applyAll(db)).resolves.toBeUndefined();

    expect(await constraints(db, "marketplace_acceptances")).toEqual(before);
    await db.close();
  });

  it("checks the provider's SHAPE, not a closed list: a new adapter's id is a row, a malformed one is not", async () => {
    const db = new PGlite();
    await applyAll(db);

    await expect(db.exec(insertAcceptance("NINETY_NINE_FOOD"))).resolves.toBeDefined();
    await expect(db.exec(insertAcceptance("ifood"))).rejects.toThrow(/provider_shape/);
    await db.close();
  });

  it("holds the cancellation request to its four states", async () => {
    const db = new PGlite();
    await applyAll(db);
    await db.exec(insertAcceptance("IFOOD"));

    await expect(
      db.exec("UPDATE marketplace_acceptances SET cancellation_status = 'REQUESTED'"),
    ).resolves.toBeDefined();
    await expect(db.exec("UPDATE marketplace_acceptances SET cancellation_status = 'MAYBE'")).rejects.toThrow(
      /cancellation_status_check/,
    );
    await db.close();
  });

  it("adopts the predecessor's table: adds the columns, drops the closed list, keeps the host's foreign key", async () => {
    const db = new PGlite();
    await db.exec(PREDECESSOR);

    await applyAll(db);

    expect(await columns(db, "marketplace_acceptances")).toEqual(
      expect.arrayContaining(["confirmed_at", "cancellation_status", "cancellation_reason_code", "delivered_by"]),
    );
    const names = await constraints(db, "marketplace_acceptances");
    expect(names).toContain("marketplace_acceptances_order_id_fkey");
    expect(names).toContain("marketplace_acceptances_provider_shape");
    expect(names).not.toContain("marketplace_acceptances_provider_valid");
    await db.close();
  });
});
