import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { createHarness } from "./harness";
import { pgliteDb } from "./pglite-db";

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

/**
 * [R2-1] Adoption must not turn the predecessor's ACCEPTED orders into confirms
 * the engine owes: on main nothing confirmed through an API, so the outbound
 * sweep's first pass would otherwise send a day of finished orders' confirms.
 * The harness clock is 2026-11-11T12:00Z; the rows are 1 h and 3 h older.
 */
describe("adopting the predecessor's accepted orders", () => {
  const ACCEPTED_ROWS = `
    INSERT INTO orders VALUES ('o-1h'), ('o-3h'), ('o-wait');
    INSERT INTO marketplace_acceptances (id, client_id, order_id, provider, external_order_id, status, acknowledge_by, acknowledged_at, updated_at) VALUES
      ('a1', 't', 'o-1h', 'IFOOD', 'x1', 'ACCEPTED', NULL, '2026-11-11T11:00:00Z', now()),
      ('a2', 't', 'o-3h', 'IFOOD', 'x2', 'ACCEPTED', NULL, '2026-11-11T09:00:00Z', now()),
      ('a3', 't', 'o-wait', 'IFOOD', 'x3', 'AWAITING', '2026-11-11T12:05:00Z', NULL, now());`;

  async function confirmedAt(db: PGlite): Promise<Record<string, unknown>> {
    const rows = (await db.query<{ order_id: string; confirmed_at: Date | null }>(
      "SELECT order_id, confirmed_at FROM marketplace_acceptances ORDER BY order_id",
    )).rows;
    return Object.fromEntries(rows.map((row) => [row.order_id, row.confirmed_at?.toISOString() ?? null]));
  }

  async function sweepQueues(db: PGlite): Promise<string[]> {
    const h = createHarness({ store: pgliteDb(db) });
    await h.engine.sweepOutbound();
    return h.enqueued.map((job) => `${job.payload.action}:${job.payload.orderId}`);
  }

  it("stamps them confirmed at their acceptance, so the first sweep queues no confirm", async () => {
    const db = new PGlite();
    await db.exec(PREDECESSOR + ACCEPTED_ROWS);

    await applyAll(db);

    expect(await confirmedAt(db)).toEqual({
      "o-1h": "2026-11-11T11:00:00.000Z",
      "o-3h": "2026-11-11T09:00:00.000Z",
      "o-wait": null,
    });
    expect(await sweepQueues(db)).toEqual([]);
    await db.close();
  });

  it("stamps them too on a host that already ran the unmerged outbound migration (the columns exist, NULL)", async () => {
    const db = new PGlite();
    await db.exec(
      PREDECESSOR +
        `ALTER TABLE "marketplace_acceptances" ADD COLUMN "confirmed_at" TIMESTAMP(3);
         ALTER TABLE "marketplace_acceptances" ADD COLUMN "confirm_failed_at" TIMESTAMP(3);
         ALTER TABLE "marketplace_acceptances" ADD COLUMN "cancellation_status" TEXT;
         ALTER TABLE "marketplace_acceptances" ADD COLUMN "cancellation_reason_code" TEXT;` +
        ACCEPTED_ROWS,
    );

    await applyAll(db);

    expect((await confirmedAt(db))["o-1h"]).toBe("2026-11-11T11:00:00.000Z");
    expect(await sweepQueues(db)).toEqual([]);
    await db.close();
  });

  it("changes nothing on a replay: a confirm the engine genuinely owes stays owed and is swept", async () => {
    const db = new PGlite();
    await applyAll(db);
    // An order the ENGINE accepted, whose confirm has not gone out yet.
    await db.exec(`
      INSERT INTO marketplace_acceptances (id, client_id, order_id, provider, external_order_id, status, acknowledged_at, line_skus, updated_at)
      VALUES ('e1', 't', 'o-engine', 'IFOOD', 'x9', 'ACCEPTED', '2026-11-11T11:00:00Z', '["S"]', now())`);
    const before = await db.query("SELECT * FROM marketplace_acceptances ORDER BY id");

    await applyAll(db);

    const after = await db.query("SELECT * FROM marketplace_acceptances ORDER BY id");
    expect(after.rows).toEqual(before.rows);
    expect((await confirmedAt(db))["o-engine"]).toBeNull();
    expect(await sweepQueues(db)).toEqual(["confirm:o-engine"]);
    await db.close();
  });

  it("leaves a fresh host's table alone: nothing to stamp", async () => {
    const db = new PGlite();
    await applyAll(db);
    expect(await confirmedAt(db)).toEqual({});
    await db.close();
  });
});

