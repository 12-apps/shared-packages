import { describe, expect, it } from "vitest";

import type { MarketplaceDb } from "../core/ports";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp } from "./harness";
import { createMemoryDb } from "./memory-db";

/**
 * Acceptance test for FUT-5114: no outbound HTTP call to a marketplace is made
 * while a database transaction is open, on the auto-accept ingest and on the
 * store's own decision. The transaction port records its depth, and the HTTP
 * client records the depth every request was made at.
 *
 * The probe is proven by a control: the outbound job's call, made after the
 * transaction closed, IS recorded, at depth 0.
 */

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };
const ATTEMPT = { attempt: 1, maxAttempts: 3 };

function probed() {
  const memory = createMemoryDb();
  const trace = { depth: 0, entered: 0, exited: 0, httpAtDepth: [] as number[] };
  const transaction = async <T>(fn: (tx: MarketplaceDb) => Promise<T>): Promise<T> => {
    trace.depth += 1;
    trace.entered += 1;
    try {
      return await memory.transaction(fn);
    } finally {
      trace.depth -= 1;
      trace.exited += 1;
    }
  };
  const http = scriptedHttp((request) => {
    trace.httpAtDepth.push(trace.depth);
    return request.url.includes("/oauth/token") ? TOKEN : { status: 202, body: "" };
  });
  const h = createHarness({ http, store: { db: memory.db, transaction } });
  return { h, trace, http };
}

describe("no HTTP while a transaction is open (FUT-5114)", () => {
  it("auto-accept: the ingest's transaction closes before anything is sent, and the confirm runs outside one", async () => {
    const { h, trace, http } = probed();
    await h.connect("IFOOD", { autoAccept: true });

    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    expect(trace.entered).toBeGreaterThan(0);
    expect(trace.entered).toBe(trace.exited);
    expect(http.requests).toEqual([]);

    expect(await h.engine.runOutbound({ clientId: TENANT, orderId: outcome.orderId, action: "confirm" }, ATTEMPT)).toEqual({
      kind: "done",
      action: "confirm",
    });
    expect(trace.httpAtDepth.length).toBeGreaterThan(0);
    expect(trace.httpAtDepth.every((depth) => depth === 0)).toBe(true);
  });

  it("store decides: the decision's transaction closes before anything is sent, and the confirm runs outside one", async () => {
    const { h, trace, http } = probed();
    await h.connect();
    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);
    const enteredByIngest = trace.entered;

    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });

    expect(trace.entered).toBeGreaterThan(enteredByIngest);
    expect(trace.entered).toBe(trace.exited);
    expect(http.requests).toEqual([]);

    await h.engine.runOutbound({ clientId: TENANT, orderId: outcome.orderId, action: "confirm" }, ATTEMPT);
    expect(trace.httpAtDepth.length).toBeGreaterThan(0);
    expect(trace.httpAtDepth.every((depth) => depth === 0)).toBe(true);
  });
});
