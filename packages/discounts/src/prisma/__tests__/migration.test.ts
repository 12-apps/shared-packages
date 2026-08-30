import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { DISCOUNT_SCOPES, DISCOUNT_TARGET_TYPES, DISCOUNT_TYPES } from "../../engine/kinds";

/**
 * The migration, applied to REAL Postgres.
 *
 * Every other suite in this package tests a decision the code makes. This one
 * tests the only artifact no unit test can reach: the SQL a host's
 * `migrate deploy` will actually run. It is also the artifact with the worst
 * failure mode — a migration that does not apply is a deploy that stops, and
 * one that applies WRONG is a constraint quietly missing from production.
 *
 * PGlite is real Postgres compiled to WASM, which is what makes this cheap
 * enough to run in a unit lane: no container, no server, no fixture database.
 *
 * Three situations, because the migration claims to handle three:
 *
 *  1. a FRESH host — nothing exists, so it must build everything;
 *  2. a REPLAY — the whole folder re-applied, which must be a no-op;
 *  3. an EXISTING host — the pre-package `discounts` table with its narrower
 *     CHECKs, which must gain the combo columns and have those CHECKs widened.
 *
 * The third is the one that matters most and the one a schema diff cannot
 * check: a package migration sorts AFTER the host's by name, so a bare
 * `CREATE TABLE` here would fail `migrate deploy` on every database that
 * already has the table.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation, test-flakiness/no-long-text-match --
   The committed SQL and a real database ARE the subject, for the whole file.
   Mocking `readFileSync` would assert against a fixture rather than against the
   bytes a host's `migrate deploy` runs, and "use a test data builder instead of
   raw SQL" is advice for a suite testing application code — there is no builder
   below the schema being built. Each case owns its own PGlite instance, created
   inside the case and closed at the end of it, so there is no shared database
   and no order to depend on; the `db` the isolation rule flags is a local
   `const`. The long literals are table and column names, which is what a schema
   assertion is made of. Reads only, and an in-memory database that exists for
   the length of one case. */

/**
 * Every case here boots its own PGlite and applies the whole migration folder
 * to it — real Postgres, from nothing, seventeen times. That is ~700ms on an
 * idle machine and comfortably over vitest's 5s default on the two-core runner
 * that runs the whole workspace at once: the suite passes alone and times out
 * in CI, on the FIRST case, which reads as a broken migration rather than a
 * slow one.
 *
 * The budget is raised per FILE rather than per package, because it buys
 * nothing anywhere else: this is the only suite in `@12-apps/discounts` that
 * touches a database, and every other one answers in milliseconds. `shift`
 * raises `hookTimeout` for the same reason and keeps the test budget tight —
 * here the boot is deliberately inside each case (that is what makes them
 * independent, and what the file-scoped isolation waiver above rests on), so
 * the test budget is the one that has to move.
 */
vi.setConfig({ testTimeout: 60_000 });

/**
 * The WHOLE migration folder, in the name order `migrate deploy` applies it in
 * — DISCOVERED rather than listed.
 *
 * It used to name one file. That was the hand-kept list this repo keeps
 * deleting: a second migration (FUT-996's `schedule` column) landed beside it
 * and every case here went on asserting against a schema the deploy no longer
 * builds — green, while testing an artifact that had stopped existing. The
 * folder cannot fall behind itself.
 */
const MIGRATIONS_DIR = new URL("../../../prisma/migrations/", import.meta.url);

const MIGRATION = readdirSync(MIGRATIONS_DIR)
  .sort()
  .map((name) => readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS_DIR), "utf8"))
  .join("\n");

/** The `discounts` table as a host had it BEFORE this package owned the schema. */
const LEGACY_HOST = `
CREATE TABLE "discounts" (
  "id" TEXT NOT NULL, "client_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "type" TEXT NOT NULL, "percent_off_bp" INTEGER, "amount_off_cents" INTEGER,
  "scope" TEXT NOT NULL, "trigger" TEXT NOT NULL, "code" TEXT,
  "starts_at" TIMESTAMP(3), "ends_at" TIMESTAMP(3), "min_subtotal_cents" INTEGER,
  "usage_limit" INTEGER, "per_buyer_limit" INTEGER,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "stackable" BOOLEAN NOT NULL DEFAULT true, "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, "created_by" TEXT, "updated_by" TEXT,
  "search_name" TEXT, "archived_at" TIMESTAMP(3),
  CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_type_check"
  CHECK ("type" IN ('PERCENTAGE', 'FIXED_AMOUNT'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_scope_check"
  CHECK ("scope" IN ('ORDER', 'CATEGORY', 'ITEM'));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_check"
  CHECK (("type" = 'PERCENTAGE') = ("percent_off_bp" IS NOT NULL)
     AND ("type" = 'FIXED_AMOUNT') = ("amount_off_cents" IS NOT NULL));
INSERT INTO "discounts"("id","client_id","name","type","percent_off_bp","scope","trigger","updated_at")
  VALUES ('d-legacy','t1','Ten off','PERCENTAGE',1000,'ORDER','AUTOMATIC', CURRENT_TIMESTAMP);
`;

/** A throwaway database with the migration applied. */
async function migrated(before?: string): Promise<PGlite> {
  const db = new PGlite();
  if (before) await db.exec(before);
  await db.exec(MIGRATION);
  return db;
}

/** A rule, spelled fully so each case only varies what it is about. */
function insertDiscount(values: Record<string, string | number>): string {
  const columns = Object.keys(values)
    .map((key) => `"${key}"`)
    .join(",");
  const literals = Object.values(values)
    .map((value) => (typeof value === "number" ? String(value) : `'${value}'`))
    .join(",");
  return `INSERT INTO "discounts"(${columns},"updated_at") VALUES (${literals},CURRENT_TIMESTAMP);`;
}

const TEN_OFF = {
  client_id: "t1",
  name: "Ten off",
  type: "PERCENTAGE",
  percent_off_bp: 1_000,
  scope: "ORDER",
  trigger: "AUTOMATIC",
};

/**
 * A legal rule of one type: its single value column, at the only scope that
 * type is allowed at. The mapping is the CHECK's own, written out so a new
 * type cannot be added to `kinds.ts` and quietly skipped here.
 */
function ruleOf(type: (typeof DISCOUNT_TYPES)[number]): Record<string, string | number> {
  const base = { client_id: "t1", trigger: "AUTOMATIC" };
  if (type === "PERCENTAGE") return { ...base, type, percent_off_bp: 1_000, scope: "ORDER" };
  if (type === "FIXED_AMOUNT") return { ...base, type, amount_off_cents: 500, scope: "ORDER" };
  if (type === "BUNDLE_PRICE") return { ...base, type, bundle_price_cents: 2_500, scope: "COMBO" };
  return { ...base, type, free_units: 1, scope: "COMBO" };
}

async function tableNames(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
  );
  return rows.map((row) => row.table_name).sort();
}

async function columnNames(db: PGlite, table: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function count(db: PGlite, sql: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(sql);
  return Number(rows[0]?.n ?? -1);
}

describe("a fresh host", () => {
  it("D1: builds the three tables the partial declares", async () => {
    const db = await migrated();
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(["discounts", "discount_combo_slots", "discount_targets"]),
    );
    await db.close();
  });

  it("D2: accepts every type and scope this package declares", async () => {
    // The arrays in `kinds.ts` and these CHECKs are two halves of ONE set;
    // widening one without the other is how a write starts failing at the
    // database instead of at the validator. Driven FROM the arrays so adding a
    // value there without the migration fails here.
    const db = await migrated();
    for (const [index, type] of DISCOUNT_TYPES.entries()) {
      await db.exec(insertDiscount({ id: `type-${index}`, name: `Rule ${index}`, ...ruleOf(type) }));
    }
    for (const [index, scope] of DISCOUNT_SCOPES.entries()) {
      await db.exec(
        insertDiscount({ id: `scope-${index}`, ...TEN_OFF, name: `Scope ${index}`, scope }),
      );
    }
    expect(await count(db, `SELECT count(*)::int AS n FROM "discounts"`)).toBe(
      DISCOUNT_TYPES.length + DISCOUNT_SCOPES.length,
    );
    await db.close();
  });

  it("D3: refuses a combo reward on a rule that is not a combo", async () => {
    const db = await migrated();
    await expect(
      db.exec(
        insertDiscount({
          id: "d1",
          client_id: "t1",
          name: "Bad",
          type: "BUNDLE_PRICE",
          bundle_price_cents: 2_500,
          scope: "ORDER",
          trigger: "AUTOMATIC",
        }),
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("D4: refuses two value columns at once", async () => {
    const db = await migrated();
    await expect(
      db.exec(
        insertDiscount({
          id: "d1",
          client_id: "t1",
          name: "Two",
          type: "PERCENTAGE",
          percent_off_bp: 1_000,
          free_units: 1,
          scope: "ORDER",
          trigger: "AUTOMATIC",
        }),
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("D5: refuses a per-cart combo cap on a rule no combo will ever match", async () => {
    const db = await migrated();
    await expect(
      db.exec(
        insertDiscount({
          id: "d1",
          ...TEN_OFF,
          max_combo_applications: 2,
        }),
      ),
    ).rejects.toThrow();
    await db.close();
  });
});

describe("the soft-delete unique", () => {
  it("D6: lets an ARCHIVED rule keep a name a live one is using", async () => {
    // The whole reason the index is PARTIAL: an unconditional unique lets a
    // deleted coupon squat its code forever, so an operator can never recreate
    // a code they removed.
    const db = await migrated();
    await db.exec(insertDiscount({ id: "live", ...TEN_OFF }));
    await db.exec(
      `INSERT INTO "discounts"("id","client_id","name","type","percent_off_bp","scope","trigger","updated_at","archived_at")
       VALUES ('gone','t1','Ten off','PERCENTAGE',1000,'ORDER','AUTOMATIC',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`,
    );
    expect(await count(db, `SELECT count(*)::int AS n FROM "discounts"`)).toBe(2);
    await db.close();
  });

  it("D7: still refuses two LIVE rules sharing one name in a tenant", async () => {
    const db = await migrated();
    await db.exec(insertDiscount({ id: "live", ...TEN_OFF }));
    await expect(db.exec(insertDiscount({ id: "twin", ...TEN_OFF }))).rejects.toThrow();
    await db.close();
  });
});

describe("targets, by value", () => {
  async function withCombo(): Promise<PGlite> {
    const db = await migrated();
    await db.exec(
      insertDiscount({
        id: "d1",
        client_id: "t1",
        name: "Combo",
        type: "BUNDLE_PRICE",
        bundle_price_cents: 2_500,
        scope: "COMBO",
        trigger: "AUTOMATIC",
      }),
    );
    await db.exec(
      `INSERT INTO "discount_combo_slots"("id","discount_id","position","quantity") VALUES ('s1','d1',0,2);`,
    );
    return db;
  }

  it("D8: lets a slot target and a scope target name the same row", async () => {
    // Not a contrivance: a COMBO rule can also carry scope targets on its way
    // to or from another scope, and the two are different facts.
    const db = await withCombo();
    await db.exec(
      `INSERT INTO "discount_targets"("id","discount_id","slot_id","target_type","target_id") VALUES ('a','d1','s1','ITEM','burger');`,
    );
    await db.exec(
      `INSERT INTO "discount_targets"("id","discount_id","target_type","target_id") VALUES ('b','d1','ITEM','burger');`,
    );
    expect(await count(db, `SELECT count(*)::int AS n FROM "discount_targets"`)).toBe(2);
    await db.close();
  });

  it("D9: refuses the same target twice within one scope, and within one slot", async () => {
    // The partial uniques earn their keep here. NULLs are distinct in Postgres,
    // so ONE unconditional unique over `slot_id` would not constrain the scope
    // rows at all — a rule could name a category twice and cover it twice.
    const db = await withCombo();
    await db.exec(
      `INSERT INTO "discount_targets"("id","discount_id","target_type","target_id") VALUES ('b','d1','ITEM','burger');`,
    );
    await expect(
      db.exec(
        `INSERT INTO "discount_targets"("id","discount_id","target_type","target_id") VALUES ('c','d1','ITEM','burger');`,
      ),
    ).rejects.toThrow();

    const db2 = await withCombo();
    await db2.exec(
      `INSERT INTO "discount_targets"("id","discount_id","slot_id","target_type","target_id") VALUES ('a','d1','s1','ITEM','burger');`,
    );
    await expect(
      db2.exec(
        `INSERT INTO "discount_targets"("id","discount_id","slot_id","target_type","target_id") VALUES ('d','d1','s1','ITEM','burger');`,
      ),
    ).rejects.toThrow();
    await db.close();
    await db2.close();
  });

  it("D10: refuses a dimension this package does not declare", async () => {
    const db = await withCombo();
    for (const type of DISCOUNT_TARGET_TYPES) {
      await db.exec(
        `INSERT INTO "discount_targets"("id","discount_id","target_type","target_id") VALUES ('${type}','d1','${type}','x');`,
      );
    }
    await expect(
      db.exec(
        `INSERT INTO "discount_targets"("id","discount_id","target_type","target_id") VALUES ('z','d1','SUPPLIER','acme');`,
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("D11: cascades from the SLOT as well as from the rule", async () => {
    // Removing one slot of a combo must take its targets, or the next write
    // would merge them into whichever slot replaced it — a combo that saves
    // fine and prices the wrong thing.
    const db = await withCombo();
    await db.exec(
      `INSERT INTO "discount_targets"("id","discount_id","slot_id","target_type","target_id") VALUES ('a','d1','s1','ITEM','burger');`,
    );
    await db.exec(`DELETE FROM "discount_combo_slots" WHERE "id" = 's1';`);
    expect(await count(db, `SELECT count(*)::int AS n FROM "discount_targets"`)).toBe(0);
    await db.close();
  });

  it("D12: takes every target and slot when the rule itself goes", async () => {
    const db = await withCombo();
    await db.exec(
      `INSERT INTO "discount_targets"("id","discount_id","target_type","target_id") VALUES ('b','d1','ITEM','burger');`,
    );
    await db.exec(`DELETE FROM "discounts" WHERE "id" = 'd1';`);
    expect(await count(db, `SELECT count(*)::int AS n FROM "discount_targets"`)).toBe(0);
    expect(await count(db, `SELECT count(*)::int AS n FROM "discount_combo_slots"`)).toBe(0);
    await db.close();
  });
});

describe("replay", () => {
  it("D13: applying the whole folder twice is a no-op", async () => {
    // A database rebuilt from every migration replays this one after the
    // host's, so every statement in it has to survive being run again.
    const db = await migrated();
    await db.exec(MIGRATION);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(["discounts", "discount_combo_slots", "discount_targets"]),
    );
    await db.close();
  });
});

describe("a host that already had the table", () => {
  it("D14: adds the three combo columns rather than failing on CREATE TABLE", async () => {
    const db = await migrated(LEGACY_HOST);
    expect(await columnNames(db, "discounts")).toEqual(
      expect.arrayContaining(["bundle_price_cents", "free_units", "max_combo_applications"]),
    );
    await db.close();
  });

  it("D15: keeps the rows that were already there", async () => {
    const db = await migrated(LEGACY_HOST);
    expect(await count(db, `SELECT count(*)::int AS n FROM "discounts" WHERE "id"='d-legacy'`)).toBe(1);
    await db.close();
  });

  it("D16: WIDENS the narrower CHECKs the host was carrying", async () => {
    // The case a schema diff cannot make: the host's `discounts_type_check`
    // knows two types and its `scope_check` three. Adding the combo columns
    // without widening these would leave a table that accepts the column and
    // refuses every value anyone would put in it.
    const db = await migrated(LEGACY_HOST);
    await db.exec(
      insertDiscount({
        id: "combo",
        client_id: "t1",
        name: "Leve 3",
        type: "FREE_UNITS",
        free_units: 1,
        scope: "COMBO",
        trigger: "AUTOMATIC",
      }),
    );
    expect(await count(db, `SELECT count(*)::int AS n FROM "discounts" WHERE "id"='combo'`)).toBe(1);
    await db.close();
  });

  it("D17: adds the two tables that did not exist", async () => {
    const db = await migrated(LEGACY_HOST);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(["discount_combo_slots", "discount_targets"]),
    );
    await db.close();
  });
});

/**
 * The weekly schedule column (FUT-996).
 *
 * Additive by construction, which is the property worth pinning: this column
 * arrived in a second migration that sorts AFTER the first, so every case here
 * also proves the folder still replays as a whole.
 */
describe("schedule (FUT-996)", () => {
  it("is added to a FRESH host", async () => {
    const db = await migrated();
    const found = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'discounts' AND column_name = 'schedule'`,
    );
    expect(found.rows).toEqual([{ data_type: "jsonb", is_nullable: "YES" }]);
    await db.close();
  });

  it("is added to a host that already had the pre-package table", async () => {
    // The case a schema diff cannot check: the column has to arrive on a
    // database whose `discounts` table predates the package entirely.
    const db = await migrated(LEGACY_HOST);
    const found = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'discounts' AND column_name = 'schedule'`,
    );
    expect(found.rows).toHaveLength(1);
    await db.close();
  });

  it("leaves every existing rule NULL — no backfill, no repricing", async () => {
    // NULL already means what these rows mean ("always, within the campaign"),
    // so the migration cannot change the price of anything that exists.
    const db = await migrated(LEGACY_HOST);
    const found = await db.query<{ schedule: unknown }>(
      `SELECT "schedule" FROM "discounts" WHERE "id" = 'd-legacy'`,
    );
    expect(found.rows).toEqual([{ schedule: null }]);
    await db.close();
  });

  it("stores and returns a schedule blob unchanged", async () => {
    const db = await migrated();
    await db.exec(
      insertDiscount({
        id: "d-hh",
        client_id: "t1",
        name: "Happy hour",
        type: "PERCENTAGE",
        percent_off_bp: 1000,
        scope: "CATEGORY",
        trigger: "AUTOMATIC",
        schedule: '{"windows":[{"days":[4],"from":"16:00","to":"20:00"}]}',
      }),
    );
    const found = await db.query<{ schedule: { windows: unknown[] } }>(
      `SELECT "schedule" FROM "discounts" WHERE "id" = 'd-hh'`,
    );
    expect(found.rows[0]?.schedule).toEqual({
      windows: [{ days: [4], from: "16:00", to: "20:00" }],
    });
    await db.close();
  });

  it("replays as a no-op", async () => {
    // The whole folder, twice. A package migration sorts after a host's, so
    // "applied again" is a situation that really happens.
    const db = await migrated();
    await db.exec(MIGRATION);
    const found = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'discounts' AND column_name = 'schedule'`,
    );
    expect(found.rows).toHaveLength(1);
    await db.close();
  });
});
