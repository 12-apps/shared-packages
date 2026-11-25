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

/** A harness whose host's create delivers a CAN once armed: the cancel lands inside the ingest's transaction. */
function racing() {
  const gate: { subject?: ReturnType<typeof createHarness>; armed: boolean } = { armed: false };
  const hostOptions = {
    failCreate: false,
    onCreate: async () => {
      if (gate.armed && gate.subject) {
        gate.armed = false;
        expect(await deliverIfood(gate.subject, ifoodEvent("ext-1", "CAN"))).toEqual({ kind: "cancelled" });
      }
    },
  };
  const subject = createHarness(hostOptions);
  gate.subject = subject;
  return { h: subject, gate, hostOptions };
}

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

  describe("a CANCELLED that lands while the ingest's transaction is open (the host's create)", () => {
    it("on a first delivery: the order is cancelled once ingested, and no confirm is owed", async () => {
      const { h, gate: trigger } = racing();
      await h.connect("IFOOD", { autoAccept: true });
      trigger.armed = true;

      const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
      if (outcome.kind !== "ingested") throw new Error(outcome.kind);

      expect(h.acceptance(outcome.orderId)?.status).toBe("REJECTED");
      expect(h.refused).toEqual([{ orderId: outcome.orderId, reason: "CANCELLED" }]);
      expect(await h.engine.runOutbound({ clientId: "tenant-1", orderId: outcome.orderId, action: "confirm" }, { attempt: 1, maxAttempts: 3 })).toMatchObject({
        kind: "skipped",
      });
    });

    it("on the sweep's re-run of a FAILED row: the same", async () => {
      const { h, gate: trigger, hostOptions: host } = racing();
      await h.connect("IFOOD", { autoAccept: true });
      host.failCreate = true;
      expect((await deliverIfood(h, ifoodPlaced("ext-1"))).kind).toBe("failed");
      host.failCreate = false;
      trigger.armed = true;
      const [stored] = await h.engine.retryable();

      const outcome = await h.engine.reprocess(stored!);
      if (outcome.kind !== "ingested") throw new Error(outcome.kind);

      expect(h.acceptance(outcome.orderId)?.status).toBe("REJECTED");
      expect(h.refused).toEqual([{ orderId: outcome.orderId, reason: "CANCELLED" }]);
    });
  });
});
