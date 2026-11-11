import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced, scriptedHttp } from "./harness";
import { pgliteDb } from "./pglite-db";

/**
 * [N7] The engine's guarded writes on REAL Postgres: the shipped migration,
 * then ingest, a bulk decision, the store's own cancel, the marketplace's
 * events, the sweep and the outbound job, each through the engine. Every
 * write meets the migration's CHECKs (the acknowledgement pairing, the
 * cancellation states, the provider shape) — a CHECK the engine violated
 * would throw here, where the in-memory double would not.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   The committed SQL and a real database are the subject. Each case boots its
   own in-memory PGlite inside the case, so nothing is shared between cases. */

vi.setConfig({ testTimeout: 60_000 });

const MIGRATIONS = new URL("../../prisma/migrations/", import.meta.url);

async function migrated(): Promise<PGlite> {
  const pg = new PGlite();
  for (const dir of readdirSync(MIGRATIONS).sort()) {
    await pg.exec(readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), "utf8"));
  }
  return pg;
}

async function acceptanceRow(pg: PGlite, orderId: string) {
  const result = await pg.query<Record<string, unknown>>(
    "SELECT status, cancellation_status, cancellation_reason_code, confirmed_at, acknowledged_at, line_skus FROM marketplace_acceptances WHERE order_id = $1",
    [orderId],
  );
  return result.rows[0];
}

describe("the engine on real Postgres", () => {
  it("ingests, decides in bulk, cancels, takes the marketplace's answers and confirms, meeting every CHECK", async () => {
    const pg = await migrated();
    const http = scriptedHttp((request) =>
      request.url.endsWith("/token") ? { status: 200, body: JSON.stringify({ accessToken: "t" }) } : { status: 202, body: "" },
    );
    const h = createHarness({ http, store: pgliteDb(pg) });
    await h.connect();

    for (const id of ["ext-1", "ext-2", "ext-3"]) {
      expect((await deliverIfood(h, ifoodPlaced(id))).kind).toBe("ingested");
    }
    expect(await deliverIfood(h, ifoodPlaced("ext-1"))).toEqual({ kind: "duplicate" });
    expect(await acceptanceRow(pg, "order-1")).toMatchObject({ status: "AWAITING", line_skus: ["SKU-1"] });

    const decided = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: "order-1", decision: "ACCEPT" },
        { orderId: "order-2", decision: "REJECT", reasonCode: "503", offendingSkus: ["SKU-1"] },
      ],
    });
    expect(decided.kind).toBe("decided");
    expect(await acceptanceRow(pg, "order-2")).toMatchObject({
      status: "REJECTED",
      cancellation_status: "PENDING",
      cancellation_reason_code: "503",
    });

    // A refused call writes nothing, on Postgres too.
    const refused = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: "order-3", decision: "ACCEPT" },
        { orderId: "order-1", decision: "ACCEPT" },
      ],
    });
    expect(refused.kind).toBe("refused");
    expect((await acceptanceRow(pg, "order-3"))?.status).toBe("AWAITING");

    await h.engine.runOutbound({ clientId: TENANT, orderId: "order-1", action: "confirm" }, { attempt: 1, maxAttempts: 3 });
    expect((await acceptanceRow(pg, "order-1"))?.confirmed_at).toBeInstanceOf(Date);
    await h.engine.runOutbound({ clientId: TENANT, orderId: "order-2", action: "requestCancellation" }, { attempt: 1, maxAttempts: 3 });
    expect((await acceptanceRow(pg, "order-2"))?.cancellation_status).toBe("REQUESTED");
    expect((await deliverIfood(h, ifoodEvent("ext-2", "CAN"))).kind).toBe("cancelled");
    expect((await acceptanceRow(pg, "order-2"))?.cancellation_status).toBe("CONFIRMED");

    const cancelled = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId: "order-1", reasonCode: "509" });
    expect(cancelled).toMatchObject({ kind: "decided", cancellation: "PENDING" });
    expect((await deliverIfood(h, ifoodEvent("ext-1", "CARF"))).kind).toBe("cancellationFailed");
    expect((await acceptanceRow(pg, "order-1"))?.cancellation_status).toBe("FAILED");

    h.clock.at = new Date(h.clock.at.getTime() + 301_000);
    expect(await h.engine.expireLapsed()).toEqual({ expired: 1, tenants: 1 });
    expect(await acceptanceRow(pg, "order-3")).toMatchObject({ status: "EXPIRED", acknowledged_at: expect.any(Date) });
    await expect(h.engine.sweepOutbound()).resolves.toMatchObject({ givenUp: 0 });

    const archived = await h.engine.upsertIntegrations({
      clientId: TENANT,
      actorId: null,
      rows: [{ operation: "archive", provider: "IFOOD" }],
    });
    expect(archived.kind).toBe("saved");
    expect(await h.engine.target(TENANT, "IFOOD")).toBeNull();
    await pg.close();
  });
});
