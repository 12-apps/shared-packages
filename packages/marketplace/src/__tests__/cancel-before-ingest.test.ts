import { describe, expect, it } from "vitest";

import { createHarness, deliverIfood, ifoodEvent, ifoodPlaced } from "./harness";

/**
 * A cancellation that arrives after an earlier NEW_ORDER FAILED, for an
 * adapter whose webhook CARRIES the order (iFood; Rappi is pinned in
 * `rappi/__tests__/engine.test.ts`). The retry sweep re-runs the FAILED row
 * later, and it must not create a host order for an order the marketplace
 * already cancelled (FUT-4898). The fetched path (99Food) is pinned in
 * `99food/__tests__/engine.test.ts`.
 */

describe("a cancellation that outran a failed carried NEW_ORDER (FUT-4898)", () => {
  it("settles the FAILED row IGNORED on the retry and creates no host order", async () => {
    const options = { failCreate: true };
    const h = createHarness(options);
    await h.connect();

    expect((await deliverIfood(h, ifoodPlaced("ext-1"))).kind).toBe("failed");
    expect(await deliverIfood(h, ifoodEvent("ext-1", "CAN"))).toEqual({ kind: "cancelled" });

    // The host recovers; the sweep picks the FAILED row up.
    options.failCreate = false;
    const stored = (await h.engine.retryable()).find((row) => row.id === h.memory.tables.marketplaceInboxEvent.rows[0]?.id);
    expect(stored).toBeDefined();
    const outcome = await h.engine.reprocess(stored!);

    expect(outcome).toMatchObject({ kind: "ignored", reason: "cancelled before its order body arrived" });
    expect(h.created).toEqual([]);
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]).toMatchObject({ status: "IGNORED" });
  });

  it("still ingests the retried NEW_ORDER when nothing cancelled it", async () => {
    const options = { failCreate: true };
    const h = createHarness(options);
    await h.connect();

    expect((await deliverIfood(h, ifoodPlaced("ext-1"))).kind).toBe("failed");
    options.failCreate = false;
    const [stored] = await h.engine.retryable();

    expect(await h.engine.reprocess(stored!)).toMatchObject({ kind: "ingested" });
    expect(h.created).toHaveLength(1);
  });

  it("does not let one order's cancellation block another order's retry", async () => {
    const options = { failCreate: true };
    const h = createHarness(options);
    await h.connect();

    await deliverIfood(h, ifoodPlaced("ext-1"));
    await deliverIfood(h, ifoodEvent("ext-2", "CAN"));
    options.failCreate = false;
    const [stored] = await h.engine.retryable();

    expect(await h.engine.reprocess(stored!)).toMatchObject({ kind: "ingested" });
  });
});
