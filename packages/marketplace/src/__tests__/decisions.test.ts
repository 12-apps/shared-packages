import { describe, expect, it } from "vitest";

import { TENANT, createHarness, deliverIfood, ifoodPlaced, type Harness } from "./harness";

/**
 * The bulk decision path: all-or-nothing, the host's admission inside the
 * claim's transaction (B3: the stock ask, the atomic draw), and the outbound
 * call surviving a host half that throws (B1).
 */

async function ingest(h: Harness, ...externalIds: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const externalId of externalIds) {
    const outcome = await deliverIfood(h, ifoodPlaced(externalId));
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);
    ids.push(outcome.orderId);
  }
  return ids;
}

/** A host that answers MARKETPLACE_STOCK_ASK unless the person admitted it. */
const stockAskHost = () =>
  createHarness({
    admit: async (request) =>
      request.decision === "ACCEPT" && !request.admission.admitStockPastZero
        ? { admitted: false, code: "MARKETPLACE_STOCK_ASK", message: "Short of an item.", details: { short: ["Tuna"] } }
        : { admitted: true },
  });

describe("deciding many orders", () => {
  it("decides an accept and a refusal in one call, admitting each through the host inside the transaction", async () => {
    const h = createHarness();
    await h.connect();
    const [first, second] = await ingest(h, "ext-1", "ext-2");

    const result = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: first!, decision: "ACCEPT", admission: { admitStockPastZero: true } },
        { orderId: second!, decision: "REJECT", reasonCode: "509" },
      ],
    });

    expect(result).toMatchObject({ kind: "decided", validateOnly: false });
    expect(h.acceptance(first!)?.status).toBe("ACCEPTED");
    expect(h.acceptance(second!)).toMatchObject({ status: "REJECTED", cancellationReasonCode: "509" });
    expect(h.admitted.map((request) => [request.orderId, request.decision, request.admission])).toEqual([
      [first, "ACCEPT", { admitStockPastZero: true }],
      [second, "REJECT", {}],
    ]);
    // The host's admission receives the transaction's client, for its own draw.
    expect(h.admitted[0]?.db).toBe(h.memory.db);
  });

  it("[M2/A3] refuses the whole call with the host's coded refusal, writing nothing and rolling the host's draw back", async () => {
    const h = stockAskHost();
    await h.connect();
    const [first, second] = await ingest(h, "ext-1", "ext-2");

    const result = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: first!, decision: "REJECT", reasonCode: "501" },
        { orderId: second!, decision: "ACCEPT" },
      ],
    });

    expect(result).toEqual({
      kind: "refused",
      problems: [
        {
          path: ["decisions", 1],
          code: "HOST_REFUSED",
          host: { code: "MARKETPLACE_STOCK_ASK", message: "Short of an item.", details: { short: ["Tuna"] } },
        },
      ],
    });
    expect(h.acceptance(first!)?.status).toBe("AWAITING");
    expect(h.acceptance(second!)?.status).toBe("AWAITING");
    expect(h.enqueued).toHaveLength(0);
    expect(h.accepted).toHaveLength(0);
    expect(h.refused).toHaveLength(0);
  });

  it("[M2/A4] accepts once the person admits it past zero", async () => {
    const h = stockAskHost();
    await h.connect();
    const [orderId] = await ingest(h, "ext-1");

    const asked = await h.engine.decide({ clientId: TENANT, orderId: orderId!, decision: "ACCEPT" });
    const admitted = await h.engine.decide({
      clientId: TENANT,
      orderId: orderId!,
      decision: "ACCEPT",
      admission: { admitStockPastZero: true },
    });

    expect(asked).toEqual({ kind: "refusedByHost", code: "MARKETPLACE_STOCK_ASK", message: "Short of an item.", details: { short: ["Tuna"] } });
    expect(admitted).toMatchObject({ kind: "decided", status: "ACCEPTED" });
  });

  it("rolls back a host write made inside the admission when a later row is refused", async () => {
    const h = createHarness({
      admit: async (request) => {
        // The host's draw: a write through the transaction's client.
        // eslint-disable-next-line test-flakiness/no-database-operations -- the write IS the subject: the rollback must undo it.
        await request.db.marketplaceMenuLink.upsert({
          where: { clientId_provider_externalSku: { clientId: TENANT, provider: "IFOOD", externalSku: `draw-${request.orderId}` } },
          create: { clientId: TENANT, provider: "IFOOD", externalSku: `draw-${request.orderId}` },
          update: {},
        });
        return request.orderId === "order-2"
          ? { admitted: false, code: "NO", message: "no" }
          : { admitted: true };
      },
    });
    await h.connect();
    const [first, second] = await ingest(h, "ext-1", "ext-2");
    const linksBefore = h.memory.tables.marketplaceMenuLink.rows.length;

    await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: first!, decision: "ACCEPT" },
        { orderId: second!, decision: "ACCEPT" },
      ],
    });

    expect(h.memory.tables.marketplaceMenuLink.rows).toHaveLength(linksBefore);
  });

  it("names every problem with its path, and writes nothing when any row is wrong", async () => {
    const h = createHarness();
    await h.connect();
    const [first, second] = await ingest(h, "ext-1", "ext-2");
    await h.engine.decide({ clientId: TENANT, orderId: second!, decision: "ACCEPT" });

    const result = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: first!, decision: "REJECT", reasonCode: "999" },
        { orderId: second!, decision: "ACCEPT" },
        { orderId: "nope", decision: "ACCEPT" },
      ],
    });

    expect(result).toEqual({
      kind: "refused",
      problems: [
        { path: ["decisions", 0, "reasonCode"], code: "INVALID_REASON", validCodes: expect.arrayContaining(["503"]) },
        { path: ["decisions", 1, "orderId"], code: "ALREADY_DECIDED", status: "ACCEPTED" },
        { path: ["decisions", 2, "orderId"], code: "NOT_FOUND" },
      ],
    });
    expect(h.acceptance(first!)?.status).toBe("AWAITING");
  });

  it("refuses the same order twice in one call", async () => {
    const h = createHarness();
    await h.connect();
    const [orderId] = await ingest(h, "ext-1");

    const result = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [
        { orderId: orderId!, decision: "ACCEPT" },
        { orderId: orderId!, decision: "REJECT" },
      ],
    });

    expect(result).toEqual({ kind: "refused", problems: [{ path: ["decisions", 1, "orderId"], code: "DUPLICATE" }] });
  });

  it("validateOnly runs the admission and writes nothing", async () => {
    const h = createHarness();
    await h.connect();
    const [orderId] = await ingest(h, "ext-1");

    const result = await h.engine.decideMany({
      clientId: TENANT,
      validateOnly: true,
      decisions: [{ orderId: orderId!, decision: "ACCEPT" }],
    });

    expect(result).toMatchObject({ kind: "decided", validateOnly: true, rows: [{ orderId, status: "ACCEPTED" }] });
    expect(h.admitted).toHaveLength(1);
    expect(h.acceptance(orderId!)?.status).toBe("AWAITING");
    expect(h.enqueued).toHaveLength(0);
    expect(h.accepted).toHaveLength(0);
  });
});

describe("[B1] an outbound call is never lost to the host's half", () => {
  it("queues the confirm before the host's half, which may throw without losing it", async () => {
    const h = createHarness({ failHostHalf: true });
    await h.connect();
    const [orderId] = await ingest(h, "ext-1");

    const result = await h.engine.decide({ clientId: TENANT, orderId: orderId!, decision: "ACCEPT" });

    expect(result).toMatchObject({ kind: "decided", status: "ACCEPTED" });
    expect(h.enqueued.map((job) => job.payload)).toEqual([{ clientId: TENANT, orderId, action: "confirm" }]);
    expect(h.logged.some((line) => line.level === "error" && line.message.includes("host's half failed"))).toBe(true);
  });

  it("queues the cancellation request before the host's refusal, which may throw without losing it", async () => {
    const h = createHarness({ failHostHalf: true });
    await h.connect();
    const [orderId] = await ingest(h, "ext-1");

    await h.engine.decide({ clientId: TENANT, orderId: orderId!, decision: "REJECT", reasonCode: "503" });

    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["requestCancellation"]);
    expect(h.acceptance(orderId!)?.cancellationStatus).toBe("PENDING");
  });

  it("queues a born-accepted order's confirm before the host's half on ingest", async () => {
    const h = createHarness({ failHostHalf: true });
    await h.connect("IFOOD", { autoAccept: true });

    await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["confirm"]);
  });
});
