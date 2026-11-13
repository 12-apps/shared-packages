import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { MARKETPLACE_AVAILABILITY_JOB, type AvailabilityJobPayload } from "../core/pause-store";
import { TENANT, createHarness, scriptedHttp } from "./harness";
import { pgliteDb } from "./pglite-db";

/**
 * The store pause's migration (FUT-4851) on REAL Postgres: a fresh build, a
 * replay, its CHECKs, index names that are the ones Prisma derives from the
 * partial (so `migrate diff` sees no drift) and fit Postgres's 63 characters,
 * and one pause and resume through the engine against iFood's wire shapes,
 * meeting every CHECK.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation, test-flakiness/no-long-text-match --
   The committed SQL, the committed partial and a real database ARE the
   subject, and the exact URL iFood is sent is the assertion. Each case boots
   its own in-memory PGlite inside the case. */

vi.setConfig({ testTimeout: 60_000 });

const MIGRATIONS = new URL("../../prisma/migrations/", import.meta.url);
const PARTIAL = new URL("../../prisma/marketplace.prisma", import.meta.url);
const TABLE = "marketplace_store_pauses";

async function migrated(): Promise<PGlite> {
  const pg = new PGlite();
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    await pg.exec(readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), "utf8"));
  }
  return pg;
}

/** The model's block in the partial. */
function modelBlock(): string {
  const text = readFileSync(PARTIAL, "utf8");
  const start = text.indexOf("model MarketplaceStorePause {");
  return text.slice(start, text.indexOf("\n}", start));
}

const snake = (field: string): string => field.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

/** Prisma's default names for the model's `@@unique` and `@@index` lines. */
function prismaIndexNames(): string[] {
  const names: string[] = [];
  for (const match of modelBlock().matchAll(/@@(unique|index)\(\[([^\]]+)\]\)/gu)) {
    const columns = match[2]!.split(",").map((field) => snake(field.trim()));
    names.push(`${TABLE}_${columns.join("_")}_${match[1] === "unique" ? "key" : "idx"}`);
  }
  return names.sort();
}

async function indexNames(pg: PGlite): Promise<string[]> {
  const result = await pg.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE tablename = $1 AND indexname <> $2 ORDER BY indexname",
    [TABLE, `${TABLE}_pkey`],
  );
  return result.rows.map((row) => row.indexname);
}

const insert = (columns: string, values: string) =>
  `INSERT INTO ${TABLE} (id, client_id, provider, updated_at${columns}) VALUES ('p', 't', 'IFOOD', now()${values})`;

describe("the store pause migration", () => {
  it("builds the table with Prisma's index names, each within Postgres's 63 characters, and replays as a no-op", async () => {
    const pg = await migrated();
    const expected = prismaIndexNames();
    expect(expected).toHaveLength(3);
    expect(await indexNames(pg)).toEqual(expected);
    for (const name of expected) expect(name.length).toBeLessThanOrEqual(63);
    const sql = readFileSync(new URL("20261113230000_marketplace_store_pause/migration.sql", MIGRATIONS), "utf8");
    await pg.exec(sql);
    expect(await indexNames(pg)).toEqual(expected);
  });

  it("holds the state, the ask, the failure code and the provider's shape to their vocabularies", async () => {
    const pg = await migrated();
    await expect(pg.exec(insert(", state", ", 'PAUSED'"))).resolves.toBeDefined();
    await pg.exec(`DELETE FROM ${TABLE}`);
    await expect(pg.exec(insert(", state", ", 'CLOSED'"))).rejects.toThrow(/state_check/u);
    await expect(pg.exec(insert(", wanted", ", 'PAUSING'"))).rejects.toThrow(/wanted_check/u);
    await expect(pg.exec(insert(", failure_code", ", 'Loja fechada'"))).rejects.toThrow(/failure_code_check/u);
    await expect(
      pg.exec(`INSERT INTO ${TABLE} (id, client_id, provider, updated_at) VALUES ('q', 't', 'ifood', now())`),
    ).rejects.toThrow(/provider_shape/u);
  });

  it("carries a pause and a resume through the engine against iFood's wire shapes, meeting every CHECK", async () => {
    const pg = await migrated();
    const http = scriptedHttp((request) => {
      if (request.url.endsWith("/token")) return { status: 200, body: JSON.stringify({ accessToken: "t" }) };
      if (request.method === "GET") return { status: 200, body: "[]" };
      if (request.method === "POST") return { status: 201, body: JSON.stringify({ id: JSON.parse(request.body!).id }) };
      return { status: 204, body: "" };
    });
    const h = createHarness({ http, store: pgliteDb(pg) });
    await h.connect();
    const now = new Date("2026-11-11T12:00:00.000Z");
    const until = new Date("2026-11-11T12:20:00.000Z");
    expect(await h.engine.pauseStore({ clientId: TENANT, until, reason: "Cozinha cheia", timeZone: "America/Sao_Paulo", now })).toEqual({
      kind: "ok",
      marketplaces: [{ provider: "IFOOD", outcome: "queued" }],
    });
    const jobs = () => h.enqueued.filter((job) => job.name === MARKETPLACE_AVAILABILITY_JOB).map((job) => job.payload as unknown as AvailabilityJobPayload);
    expect(await h.engine.runAvailability(jobs()[0]!, { attempt: 1, maxAttempts: 3 })).toEqual({ kind: "done", state: "PAUSED" });
    const paused = (await pg.query<Record<string, unknown>>(`SELECT state, external_id, sent_until, attempt_key FROM ${TABLE}`)).rows[0];
    expect(paused).toMatchObject({ state: "PAUSED", sent_until: until, attempt_key: null });
    expect(typeof paused?.external_id).toBe("string");

    await h.engine.resumeStore({ clientId: TENANT, now });
    expect(await h.engine.runAvailability(jobs()[1]!, { attempt: 1, maxAttempts: 3 })).toEqual({ kind: "done", state: "OPEN" });
    const deletes = http.requests.filter((request) => request.method === "DELETE");
    expect(deletes.map((request) => request.url)).toEqual([
      `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/merchant-IFOOD/interruptions/${String(paused?.external_id)}`,
    ]);
    expect((await h.engine.availabilityState(TENANT))[0]).toMatchObject({ provider: "IFOOD", state: "OPEN", supported: true });
  });
});
