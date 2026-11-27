import { describe, expect, it } from "vitest";

import { TENANT, createHarness } from "../../__tests__/harness";
import { createKeetaAdapter, KEETA_PROVIDER } from "..";
import { KEETA_ADAPTER_COPY_EN_US } from "../en-US";
import { normalizeKeetaEvent } from "../normalize";
import { API_BASE, KEETA_ORDER_ID, keetaEvent } from "./fixtures";

/**
 * Keeta's rider events as courier steps (FUT-5665, ESTIMATED from the event
 * names of Keeta's order guide): the rider at the store, and the bag
 * collected, which is a lifecycle step too. No rider identity is stated.
 */
describe("Keeta's rider events", () => {
  it("RIDER_ARRIVED_AT_STORE is the courier at the counter, and moves nothing", () => {
    const event = normalizeKeetaEvent(keetaEvent("RIDER_ARRIVED_AT_STORE"));

    expect(event?.courier).toEqual({ step: "ARRIVED_AT_ORIGIN", at: new Date("2026-10-13T20:41:05Z"), courier: null, returning: null });
    expect(event?.lifecycle ?? null).toBeNull();
  });

  it("ORDER_COLLECTED is the courier holding the bag, and the COLLECTED lifecycle", () => {
    const event = normalizeKeetaEvent(keetaEvent("ORDER_COLLECTED"));

    expect(event?.courier).toMatchObject({ step: "COLLECTED", courier: null });
    expect(event?.lifecycle).toBe("COLLECTED");
  });

  it("PICKUP_ONGOING and the other events name no courier step", () => {
    for (const type of ["PICKUP_ONGOING", "DISPATCHED", "CREATED", "DELIVERED"]) {
      expect(normalizeKeetaEvent(keetaEvent(type))?.courier ?? null, type).toBeNull();
    }
  });
});

/** A Keeta acceptance, ACCEPTED, carried by `deliveredBy`, and an ORDER_COLLECTED delivered for it. */
async function collected(deliveredBy: "MERCHANT" | "MARKETPLACE") {
  const h = createHarness({ lifecycle: ["moved"], adapters: [createKeetaAdapter({ copy: KEETA_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE })] });
  await h.connect(KEETA_PROVIDER);
  await h.seedAcceptance({ clientId: TENANT, orderId: "o-keeta", provider: KEETA_PROVIDER, externalOrderId: KEETA_ORDER_ID, status: "ACCEPTED", deliveredBy });
  const payload = keetaEvent("ORDER_COLLECTED");
  const target = await h.engine.target(TENANT, KEETA_PROVIDER);
  const outcome = await h.engine.deliver({
    clientId: TENANT,
    event: h.engine.normalize(KEETA_PROVIDER, payload)!,
    payload,
    settings: { autoAccept: false, ackSlaSeconds: 300, followStatus: target?.followStatus },
  });
  return { h, outcome };
}

describe("Keeta's ORDER_COLLECTED in the lifecycle rule", () => {
  it("a bag the store carries: nothing moves and nothing is noted, so its own 'delivered' is still sent", async () => {
    const { h, outcome } = await collected("MERCHANT");

    expect(outcome).toEqual({ kind: "ignored", reason: "COLLECTED of a bag the marketplace does not carry" });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(h.memory.tables.marketplaceStatusUpdate.rows).toHaveLength(0);
  });

  it("a bag Keeta's rider carries: it moves, noted as the marketplace's HANDED_OVER", async () => {
    const { h, outcome } = await collected("MARKETPLACE");

    expect(outcome).toEqual({ kind: "moved", orderId: "o-keeta", lifecycle: "COLLECTED" });
    expect(h.memory.tables.marketplaceStatusUpdate.rows).toEqual([
      expect.objectContaining({ step: "HANDED_OVER", source: "MARKETPLACE", state: "NOTED" }),
    ]);
  });
});
