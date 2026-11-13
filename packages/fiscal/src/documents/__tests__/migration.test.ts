import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FISCAL_NEXT_NUMBER_SQL } from "../sql";

/**
 * The package's migrations on a real (WASM) Postgres: the number draw is the
 * SQL a host runs, a refused insert in the same transaction gives the number
 * back, a series belongs to one issuing point, and the CHECKs refuse what the
 * state machine never writes.
 */

const MIGRATIONS = join(import.meta.dirname, "../../../prisma/migrations");

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  for (const dir of readdirSync(MIGRATIONS).filter((name) => /^\d/.test(name)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8"));
  }
  await db.exec(`
    INSERT INTO "fiscal_issuing_points" ("id", "owner_id", "model", "online_series", "contingency_series")
    VALUES ('register-1', 'owner-1', 'NFCE', 1, 2);
    INSERT INTO "fiscal_number_counters" ("issuer_cnpj", "environment", "model", "series", "issuing_point_id", "series_kind", "next_number")
    VALUES ('11222333000181', 'homologacao', 'NFCE', 1, 'register-1', 'ONLINE', 1201),
           ('11222333000181', 'homologacao', 'NFCE', 2, 'register-1', 'CONTINGENCY', 1);
  `);
});

afterEach(async () => {
  await db.close();
});

const DRAW = ["11222333000181", "homologacao", "NFCE", 1, "register-1"];

async function draw(tx: Pick<PGlite, "query"> = db): Promise<number | undefined> {
  const { rows } = await tx.query<{ number: number }>(FISCAL_NEXT_NUMBER_SQL, DRAW);
  return rows[0]?.number;
}

function insertDocument(id: string, number: number, status = "PENDING", subject = id): string {
  return `INSERT INTO "fiscal_documents" ("id", "owner_id", "issuer_cnpj", "subject_id", "issuing_point_id", "model", "environment",
      "series_kind", "series", "number", "key_code", "status", "sale", "totals", "issued_at", "created_at", "updated_at")
    VALUES ('${id}', 'owner-1', '11222333000181', '${subject}', 'register-1', 'NFCE', 'homologacao', 'ONLINE', 1, ${number}, '12345678',
      '${status}', '{}', '{}', '2026-11-20T12:30:00-03:00', now(), now())`;
}

describe("the fiscal migration", () => {
  it("draws the series' numbers in order", async () => {
    expect([await draw(), await draw(), await draw()]).toEqual([1201, 1202, 1203]);
  });

  it("gives the number back when the document insert in the same transaction fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        const number = await draw(tx);
        expect(number).toBe(1201);
        await tx.exec(insertDocument("doc-1", number!, "NOT_A_STATUS"));
      }),
    ).rejects.toThrow(/fiscal_documents_status_check/);
    await db.transaction(async (tx) => {
      const number = await draw(tx);
      await tx.exec(insertDocument("doc-1", number!));
    });
    const { rows } = await db.query<{ number: number }>(`SELECT "number" FROM "fiscal_documents"`);
    expect(rows).toEqual([{ number: 1201 }]);
  });

  it("answers no number for a series that is not the issuing point's", async () => {
    const { rows } = await db.query(FISCAL_NEXT_NUMBER_SQL, ["11222333000181", "homologacao", "NFCE", 1, "register-2"]);
    expect(rows).toEqual([]);
  });

  it("lets a series of a CNPJ belong to one issuing point only, whichever owner holds it", async () => {
    await db.exec(`INSERT INTO "fiscal_issuing_points" ("id", "owner_id", "model", "online_series") VALUES ('register-2', 'owner-1', 'NFCE', 3)`);
    await expect(
      db.exec(`INSERT INTO "fiscal_number_counters" ("issuer_cnpj", "environment", "model", "series", "issuing_point_id", "series_kind", "next_number")
        VALUES ('11222333000181', 'homologacao', 'NFCE', 2, 'register-2', 'ONLINE', 1)`),
    ).rejects.toThrow(/fiscal_number_counters_pkey/);
  });

  it("refuses a second document on the same number, and a number past the layout's", async () => {
    await db.exec(insertDocument("doc-1", 1201));
    await expect(db.exec(insertDocument("doc-2", 1201))).rejects.toThrow(/number_key/);
    await db.exec(`UPDATE "fiscal_number_counters" SET "next_number" = 999999999 WHERE "series" = 1`);
    expect(await draw()).toBe(999999999);
    await expect(draw()).rejects.toThrow(/next_number_check/);
  });

  it("refuses an authorised document without its key and protocol, and an NF-e point with a contingency series", async () => {
    await expect(db.exec(insertDocument("doc-1", 1201, "AUTHORIZED"))).rejects.toThrow(/fiscal_documents_authorized_check/);
    await expect(
      db.exec(`INSERT INTO "fiscal_issuing_points" ("id", "owner_id", "model", "online_series", "contingency_series") VALUES ('nfe-1', 'owner-1', 'NFE', 1, 2)`),
    ).rejects.toThrow(/contingency_series_check/);
  });

  it("keeps a certificate whole: ciphertext, password and expiry together", async () => {
    const profile = (certificate: string) => `INSERT INTO "fiscal_emitter_profiles" ("owner_id", "cnpj", "state_registration",
        "legal_name", "tax_regime", "regime", "regime_effective_from", "restaurant_regime", "address", "environment",
        "document_policy", "signing_identity", "certificate_ciphertext", "updated_at")
      VALUES ('owner-9', '11222333000181', 'ISENTO', 'Test', 'SIMPLES', 'SIMPLES', '2026-01-01', true, '{}', 'homologacao',
        'ISSUED_HERE', 'STORE_CERTIFICATE', ${certificate}, now())`;
    await expect(db.exec(profile("'cipher'"))).rejects.toThrow(/fiscal_emitter_profiles_certificate_check/);
    await db.exec(profile("NULL"));
  });
});
