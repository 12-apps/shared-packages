import { describe, expect, it } from "vitest";

import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced, type Harness } from "./harness";

/**
 * The engine rows of the acceptance contract: the decision, the store's own
 * cancellation, the sweep, and the inbound events that answer a request.
 * Case ids in brackets are the contract's (I1 contract §1); the HOST half of
 * each row (stock, settlement, the board) is the host's own suite.
 */

async function ingestOne(h: Harness, externalOrderId = "ext-1"): Promise<string> {
  const outcome = await deliverIfood(h, ifoodPlaced(externalOrderId));
  if (outcome.kind !== "ingested") throw new Error(`expected ingested, got ${outcome.kind}`);
  return outcome.orderId;
}

describe("accepting an order on the clock", () => {
  it("[A1/M1] moves the row to ACCEPTED, runs the host's half once and queues one confirm with no HTTP", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    const result = await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    expect(result).toMatchObject({ kind: "decided", status: "ACCEPTED" });
    expect(h.acceptance(orderId)).toMatchObject({ status: "ACCEPTED", acknowledgedAt: h.clock.at });
    expect(h.accepted).toEqual([orderId]);
    expect(h.enqueued).toEqual([
      {
        name: "marketplace.outbound",
        payload: { clientId: TENANT, orderId, action: "confirm" },
        dedupeKey: `marketplace.outbound:confirm:${orderId}`,
      },
    ]);
    expect(h.http.requests).toHaveLength(0);
  });

  it("[A2] answers a second accept as stale: one host half, one confirm queued", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    const second = await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    expect(second).toEqual({ kind: "stale" });
    expect(h.accepted).toHaveLength(1);
    expect(h.enqueued).toHaveLength(1);
  });

  it("[S2/S3] refuses to accept a row the sweep expired, writing and queueing nothing", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    h.clock.at = new Date(h.clock.at.getTime() + 301_000);
    expect(await h.engine.expireLapsed()).toEqual({ expired: 1, tenants: 1 });

    const result = await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    expect(result).toEqual({ kind: "stale" });
    expect(h.acceptance(orderId)?.status).toBe("EXPIRED");
    expect(h.accepted).toHaveLength(0);
    expect(h.enqueued).toHaveLength(0);
    expect(h.refused).toEqual([{ orderId, reason: "EXPIRED" }]);
  });

  it("[S1] never expires an accepted order, whatever the clock says", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    h.clock.at = new Date(h.clock.at.getTime() + 3_600_000);

    expect(await h.engine.expireLapsed()).toEqual({ expired: 0, tenants: 0 });
    expect(h.acceptance(orderId)?.status).toBe("ACCEPTED");
    expect(h.refused).toHaveLength(0);
  });

  it("answers an order that is not this tenant's as stale", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    expect(await h.engine.decide({ clientId: "someone-else", orderId, decision: "ACCEPT" })).toEqual({
      kind: "stale",
    });
    expect(h.acceptance(orderId)?.status).toBe("AWAITING");
  });
});

describe("refusing an order on the clock", () => {
  it("[R1/M3] stamps REJECTED with the code, PENDING, cancels the host order and queues the request", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    const result = await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });

    expect(result).toEqual({
      kind: "decided",
      orderId,
      status: "REJECTED",
      cancellation: "PENDING",
      reasonCode: "503",
    });
    expect(h.acceptance(orderId)).toMatchObject({
      status: "REJECTED",
      cancellationStatus: "PENDING",
      cancellationReasonCode: "503",
    });
    expect(h.refused).toEqual([{ orderId, reason: "REJECTED" }]);
    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["requestCancellation"]);
    expect(h.http.requests).toHaveLength(0);
  });

  it("[R4] takes the marketplace's first reason when the store named none", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT" });

    expect(h.acceptance(orderId)?.cancellationReasonCode).toBe("501");
  });

  it("[R5] refuses a code that is not the marketplace's, and writes and queues nothing", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    const result = await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "999" });

    expect(result.kind).toBe("invalidReason");
    expect(result.kind === "invalidReason" && result.validCodes).toContain("503");
    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: null });
    expect(h.refused).toHaveLength(0);
    expect(h.enqueued).toHaveLength(0);
  });

  it("[R3] suggests the item-unavailable reason when the host says the order is short, else the first", () => {
    const h = createHarness();
    expect(h.engine.suggestReason("IFOOD", { itemUnavailable: true })?.code).toBe("503");
    expect(h.engine.suggestReason("IFOOD", { itemUnavailable: false })?.code).toBe("501");
    expect(h.engine.suggestReason("NOBODY", { itemUnavailable: true })).toBeNull();
  });
});

describe("the store's own cancel, through the host's cancel", () => {
  it("[R2] stamps an ACCEPTED order REJECTED with PENDING and the code, keeps its acceptance instant, queues once", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    const acceptedAt = h.acceptance(orderId)?.acknowledgedAt;
    h.clock.at = new Date(h.clock.at.getTime() + 60_000);

    const result = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "509" });

    expect(result).toMatchObject({ kind: "decided", status: "REJECTED", cancellation: "PENDING", reasonCode: "509" });
    expect(h.acceptance(orderId)).toMatchObject({
      status: "REJECTED",
      acknowledgedAt: acceptedAt,
      cancellationStatus: "PENDING",
      cancellationReasonCode: "509",
    });
    // The host's own cancel already ran: the engine does not ask it again.
    expect(h.refused).toHaveLength(0);
    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["confirm", "requestCancellation"]);
  });

  it("makes one request per order, whatever the taps", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "509" });
    const second = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "501" });

    expect(second).toEqual({ kind: "stale" });
    expect(h.acceptance(orderId)?.cancellationReasonCode).toBe("509");
    expect(h.enqueued).toHaveLength(1);
  });

  it("[R6] answers stale, sends nothing, when the marketplace already cancelled it", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    const result = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "509" });

    expect(result).toEqual({ kind: "stale" });
    expect(h.enqueued).toHaveLength(0);
  });

  it("validates the code before anything is written", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);

    const result = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "999" });

    expect(result.kind).toBe("invalidReason");
    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: null });
  });
});

describe("the marketplace's answers to a cancellation request", () => {
  it("[R7] CANCELLED after the store's request confirms it, and tells the host once", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "509" });

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("CONFIRMED");
    expect(h.refused).toEqual([{ orderId, reason: "CANCELLED" }]);
  });

  it("[J5] CANCELLATION_REQUEST_FAILED is understood, not ignored, and marks FAILED", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });
    h.patchAcceptance(orderId, { cancellationStatus: "REQUESTED" });

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", "CANCELLATION_REQUEST_FAILED"));

    expect(outcome).toEqual({ kind: "cancellationFailed" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("FAILED");
    const inbox = h.memory.tables.marketplaceInboxEvent.rows.at(-1);
    expect(inbox?.status).toBe("PROCESSED");
  });

  it("keeps CONFIRMED terminal: a refusal arriving after the cancellation changes nothing", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });
    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    await deliverIfood(h, ifoodEvent("ext-1", "CARF"));

    expect(h.acceptance(orderId)?.cancellationStatus).toBe("CONFIRMED");
  });

  it("turns FAILED into CONFIRMED when the cancellation arrives after all", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });
    await deliverIfood(h, ifoodEvent("ext-1", "CARF"));
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("FAILED");

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(h.acceptance(orderId)?.cancellationStatus).toBe("CONFIRMED");
  });

  it("[L1] a marketplace cancel of an accepted order queues no request of the store's", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: null });
    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["confirm"]);
    expect(h.refused).toEqual([{ orderId, reason: "CANCELLED" }]);
  });
});

describe("what the host's order reads are given", () => {
  it("states each order's aceite, request and app link in one read", async () => {
    const h = createHarness();
    await h.connect();
    const orderId = await ingestOne(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });

    const states = await h.engine.orderStates(TENANT, [orderId, "not-a-marketplace-order"]);

    expect([...states.keys()]).toEqual([orderId]);
    expect(states.get(orderId)).toMatchObject({
      provider: "IFOOD",
      status: "REJECTED",
      cancellation: "PENDING",
      cancellationReasonCode: "503",
      appUrl: expect.stringMatching(/^https:\/\//),
    });
  });
});
