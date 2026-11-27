import { describe, expect, it } from "vitest";

import { normalizeKeetaEvent } from "../normalize";
import { keetaEvent } from "./fixtures";

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
