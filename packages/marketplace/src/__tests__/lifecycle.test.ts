import { describe, expect, it } from "vitest";

import type { MarketplaceLifecycleAnswer } from "../core/ports";
import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced, type Harness } from "./harness";

/* eslint-disable test-flakiness/no-test-isolation --
   Every case builds its OWN harness (`createHarness`) inside the case, and its
   engine, database and queue are local to it: the rule reads a call on that
   local (`h.setNow(...)`, `h.seedStatus(...)`) as a write to shared state. */

/**
 * The engine's half of FUT-4653's inbound rows (contract §3 R-in, R-echo,
 * R-note, R-switch, R-unknown; §4.1-4.3): an iFood DSP or CON is a LIFECYCLE
 * event, and with the connection's switch ON and a host that binds
 * `onLifecycle` the engine asks the host to move the order forward. The rules
 * the engine owns (the acceptance's state, a standing cancellation request,
 * the echo of a step we informed, the note of what the marketplace said, the
 * deferral of an event whose order is not here yet) are pinned here; where the
 * order moves is the host's and is not asserted.
 */

const DSP = "DSP";
const CON = "CON";

/** A connected tenant whose order is ingested and accepted; the order id comes back. */
async function acceptedOrder(h: Harness, deliveredBy: "MERCHANT" | "MARKETPLACE" | null = "MERCHANT"): Promise<string> {
  const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });
  h.patchAcceptance(outcome.orderId, { deliveredBy });
  return outcome.orderId;
}

function inboxRow(h: Harness, eventId: string): Record<string, unknown> | undefined {
  return h.memory.tables.marketplaceInboxEvent.rows.find((row) => row.eventId === eventId);
}

function statusRows(h: Harness): Record<string, unknown>[] {
  return h.memory.tables.marketplaceStatusUpdate.rows;
}

async function harness(
  answers: MarketplaceLifecycleAnswer | readonly (MarketplaceLifecycleAnswer | Error)[] = "moved",
  settings: { followStatus?: boolean } = {},
): Promise<Harness> {
  const h = createHarness({ lifecycle: Array.isArray(answers) ? answers : [answers as MarketplaceLifecycleAnswer] });
  await h.connect("IFOOD", settings);
  return h;
}

describe("a lifecycle event is understood", () => {
  it("[O12] an iFood DSP and CON name their lifecycle, and nothing else does", () => {
    const h = createHarness();
    const lifecycle = (code: string) => h.engine.normalize("IFOOD", ifoodEvent("ext-1", code))?.lifecycle ?? null;

    expect(lifecycle(DSP)).toBe("DISPATCHED");
    expect(lifecycle(CON)).toBe("CONCLUDED");
    expect(lifecycle("CONCLUDED")).toBe("CONCLUDED");
    for (const code of ["CFM", "RTP", "CAN", "CARF", "ASSIGN_DRIVER"]) expect(lifecycle(code)).toBeNull();
    expect(h.engine.normalize("IFOOD", ifoodPlaced("ext-1"))?.lifecycle ?? null).toBeNull();
  });
});

describe("the rules the engine owns before it asks the host", () => {
  it("[D1][C1] never moves an order the store has not accepted: AWAITING is left for the aceite", async () => {
    const h = await harness();
    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    const dsp = await deliverIfood(h, ifoodEvent("ext-1", DSP));
    const con = await deliverIfood(h, ifoodEvent("ext-1", CON));

    expect(dsp).toEqual({ kind: "ignored", reason: "the order is AWAITING, not ACCEPTED" });
    expect(con).toEqual({ kind: "ignored", reason: "the order is AWAITING, not ACCEPTED" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "IGNORED", error: "the order is AWAITING, not ACCEPTED" });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it("[D7][C8] never revives an order the marketplace or the store ended", async () => {
    const h = await harness();
    const orderId = await acceptedOrder(h);
    h.patchAcceptance(orderId, { status: "REJECTED" });

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome).toEqual({ kind: "ignored", reason: "the order is REJECTED, not ACCEPTED" });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it.each(["PENDING", "REQUESTED"])("[D12][C9] leaves an order alone while its cancellation request is %s", async (standing) => {
    const h = await harness();
    const orderId = await acceptedOrder(h);
    h.patchAcceptance(orderId, { cancellationStatus: standing });

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", CON));

    expect(outcome).toEqual({ kind: "ignored", reason: `a cancellation request is ${standing}` });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it("acts on an order whose own cancellation request FAILED: it is still the store's order", async () => {
    const h = await harness();
    const orderId = await acceptedOrder(h);
    h.patchAcceptance(orderId, { cancellationStatus: "FAILED" });

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome.kind).toBe("moved");
    expect(h.lifecycleCalls).toHaveLength(1);
  });
});

describe("what the host answers", () => {
  it("[D2][C2] moved: the inbox is PROCESSED, the marketplace's word is noted, the host got the facts", async () => {
    const h = await harness("moved");
    const orderId = await acceptedOrder(h, "MARKETPLACE");

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome).toEqual({ kind: "moved", orderId, lifecycle: "DISPATCHED" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "PROCESSED", error: null });
    expect(h.lifecycleCalls).toHaveLength(1);
    expect(h.lifecycleCalls[0]).toMatchObject({
      orderId,
      event: { lifecycle: "DISPATCHED", provider: "IFOOD", externalOrderId: "ext-1" },
      facts: { deliveredBy: "MARKETPLACE" },
    });
    expect(statusRows(h)).toEqual([
      expect.objectContaining({ clientId: TENANT, orderId, provider: "IFOOD", step: "DISPATCHED", source: "MARKETPLACE", state: "NOTED" }),
    ]);
  });

  it("[C2] a CONCLUDED is noted as CONCLUDED", async () => {
    const h = await harness("moved");
    const orderId = await acceptedOrder(h, null);

    await deliverIfood(h, ifoodEvent("ext-1", CON));

    expect(h.lifecycleCalls[0]?.facts.deliveredBy).toBeNull();
    expect(statusRows(h)).toEqual([expect.objectContaining({ orderId, step: "CONCLUDED", source: "MARKETPLACE", state: "NOTED" })]);
  });

  it("[D5][D9][D10] unchanged: IGNORED with the engine's reason, and still noted", async () => {
    const h = await harness("unchanged");
    const orderId = await acceptedOrder(h);

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome).toEqual({ kind: "ignored", reason: "already at or past DISPATCHED" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "IGNORED", error: "already at or past DISPATCHED" });
    expect(statusRows(h)).toEqual([expect.objectContaining({ orderId, step: "DISPATCHED", source: "MARKETPLACE", state: "NOTED" })]);
  });

  it("[D8][D11] unchanged with the host's own reason: that reason is the inbox's, and the word is noted", async () => {
    const h = await harness({ kind: "unchanged", reason: "no courier named for a merchant delivery" });
    const orderId = await acceptedOrder(h);

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome).toEqual({ kind: "ignored", reason: "no courier named for a merchant delivery" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "IGNORED", error: "no courier named for a merchant delivery" });
    expect(statusRows(h)).toEqual([expect.objectContaining({ orderId, step: "DISPATCHED", state: "NOTED" })]);
  });

  it("[X7] a host hook that throws leaves the inbox FAILED, and the reconcile pass runs it again", async () => {
    const h = await harness([new Error("host is down"), "moved"]);
    await acceptedOrder(h);

    const first = await deliverIfood(h, ifoodEvent("ext-1", DSP));
    expect(first).toEqual({ kind: "failed", reason: "host is down" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "FAILED" });
    expect(statusRows(h)).toHaveLength(0);

    const pending = await h.engine.retryable();
    expect(pending).toHaveLength(1);
    const again = await h.engine.reprocess(pending[0]!);

    expect(again.kind).toBe("moved");
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "PROCESSED" });
    expect(statusRows(h)).toHaveLength(1);
  });

  it("[O3] the same event id twice is a duplicate and the host hears it once", async () => {
    const h = await harness("moved");
    await acceptedOrder(h);

    const first = await deliverIfood(h, ifoodEvent("ext-1", DSP, "evt-same"));
    const second = await deliverIfood(h, ifoodEvent("ext-1", DSP, "evt-same"));

    expect(first.kind).toBe("moved");
    expect(second).toEqual({ kind: "duplicate" });
    expect(h.lifecycleCalls).toHaveLength(1);
  });

  it("[O1][O2] a CON then a DSP: each event is the host's to judge, and each is noted once", async () => {
    const h = await harness(["moved", "unchanged"]);
    await acceptedOrder(h);

    const con = await deliverIfood(h, ifoodEvent("ext-1", CON));
    const dsp = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(con.kind).toBe("moved");
    expect(dsp).toEqual({ kind: "ignored", reason: "already at or past DISPATCHED" });
    expect(statusRows(h).map((row) => row.step).sort()).toEqual(["CONCLUDED", "DISPATCHED"]);
  });
});

describe("the echo of a step we informed (R-echo)", () => {
  async function informed(h: Harness, orderId: string, step: string, state: string): Promise<void> {
    await h.seedStatus({ orderId, step, source: "STORE", state });
  }

  it.each(["SENDING", "SENT", "FAILED"])("[E1][E3] a DSP after our DISPATCHED (%s) is ours and moves nothing", async (state) => {
    const h = await harness("moved");
    const orderId = await acceptedOrder(h);
    await informed(h, orderId, "DISPATCHED", state);

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome).toEqual({ kind: "ignored", reason: "echo of our DISPATCHED" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "IGNORED", error: "echo of our DISPATCHED" });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(1);
  });

  it("[C10] a CON after our HANDED_OVER is ours and moves nothing", async () => {
    const h = await harness("moved");
    const orderId = await acceptedOrder(h);
    await informed(h, orderId, "HANDED_OVER", "SENT");

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", CON));

    expect(outcome).toEqual({ kind: "ignored", reason: "echo of our HANDED_OVER" });
    expect(h.lifecycleCalls).toHaveLength(0);
  });

  it("an informed READY is not an echo of a DSP", async () => {
    const h = await harness("moved");
    const orderId = await acceptedOrder(h);
    await informed(h, orderId, "READY", "SENT");

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome.kind).toBe("moved");
  });
});

describe("an event whose order is not here yet (R-unknown)", () => {
  it("[O4] is deferred PENDING with the attempt counted, and the host is not called", async () => {
    const h = await harness("moved");

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", CON));

    expect(outcome).toEqual({ kind: "ignored", reason: "lifecycle before its order" });
    expect(inboxRow(h, "evt-ext-1-CON")).toMatchObject({ status: "PENDING", attempts: 1, error: "lifecycle before its order" });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it("[O5] the reconcile pass ingests the older PLC and then applies the CON", async () => {
    const h = await harness("moved");
    // The PLC arrived first but the process died before it was processed: PENDING.
    const placed = ifoodPlaced("ext-1");
    const event = h.engine.normalize("IFOOD", placed)!;
    await h.seedInbox({
      clientId: TENANT,
      provider: "IFOOD",
      eventId: event.eventId,
      eventType: event.eventType,
      externalOrderId: "ext-1",
      payload: placed,
      receivedAt: new Date("2026-11-11T11:00:00.000Z"),
    });
    h.setNow(new Date("2026-11-11T11:30:00.000Z"));
    await deliverIfood(h, ifoodEvent("ext-1", CON));
    expect(inboxRow(h, "evt-ext-1-CON")).toMatchObject({ status: "PENDING" });

    const pending = await h.engine.retryable();
    expect(pending.map((row) => (row.payload as { code: string }).code)).toEqual(["PLC", "CON"]);
    for (const row of pending) await h.engine.reprocess(row);

    expect(h.created).toHaveLength(1);
    // The order is ingested but not accepted when the CON is applied: AWAITING is never moved.
    expect(inboxRow(h, "evt-ext-1-CON")).toMatchObject({ status: "IGNORED", error: "the order is AWAITING, not ACCEPTED" });
  });

  it("[O5] with the order accepted by then, the pass applies the deferred CON", async () => {
    const h = await harness("moved");
    await deliverIfood(h, ifoodEvent("ext-1", CON));
    const orderId = await acceptedOrder(h);

    for (const row of await h.engine.retryable()) await h.engine.reprocess(row);

    expect(h.lifecycleCalls.map((call) => call.orderId)).toEqual([orderId]);
    expect(inboxRow(h, "evt-ext-1-CON")).toMatchObject({ status: "PROCESSED" });
  });

  it("is retired after maxInboxAttempts, costing nothing but the passes", async () => {
    const h = await harness("moved");
    await deliverIfood(h, ifoodEvent("ext-9", CON));

    for (let pass = 0; pass < 10; pass += 1) for (const row of await h.engine.retryable()) await h.engine.reprocess(row);

    expect(inboxRow(h, "evt-ext-9-CON")).toMatchObject({ status: "PENDING", attempts: 5 });
    expect(await h.engine.retryable()).toHaveLength(0);
    expect(h.lifecycleCalls).toHaveLength(0);
  });
});

describe("the switch (R-switch)", () => {
  it("[O8] a new connection follows the status; the view says so", async () => {
    const h = await harness();

    expect((await h.engine.integrations(TENANT))[0]?.followStatus).toBe(true);
    expect((await h.engine.target(TENANT, "IFOOD"))?.followStatus).toBe(true);
  });

  it("[O6] OFF: exactly the engine's old answer, no host call, no row", async () => {
    const h = await harness("moved", { followStatus: false });
    await acceptedOrder(h);

    const dsp = await deliverIfood(h, ifoodEvent("ext-1", DSP));
    const con = await deliverIfood(h, ifoodEvent("ext-1", CON));

    expect(dsp).toEqual({ kind: "ignored", reason: "no order body on DSP" });
    expect(con).toEqual({ kind: "ignored", reason: "no order body on CON" });
    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "IGNORED", error: "no order body on DSP" });
    expect(h.lifecycleCalls).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
    expect(h.queued).toHaveLength(1); // the aceite's confirm, nothing else
  });

  it("[O7] turning it ON later replays nothing: an IGNORED row is never re-run", async () => {
    const h = await harness("moved", { followStatus: false });
    await acceptedOrder(h);
    await deliverIfood(h, ifoodEvent("ext-1", DSP));

    await h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", followStatus: true });

    expect(await h.engine.retryable()).toHaveLength(0);
    expect(h.lifecycleCalls).toHaveLength(0);
    expect((await h.engine.integrations(TENANT))[0]?.followStatus).toBe(true);
  });

  it("the reconcile pass reads the CURRENT switch, not the one the event arrived under", async () => {
    const h = await harness([new Error("host is down"), "moved"]);
    await acceptedOrder(h);
    await deliverIfood(h, ifoodEvent("ext-1", DSP));
    await h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", followStatus: false });

    for (const row of await h.engine.retryable()) await h.engine.reprocess(row);

    expect(inboxRow(h, "evt-ext-1-DSP")).toMatchObject({ status: "IGNORED", error: "no order body on DSP" });
    expect(h.lifecycleCalls).toHaveLength(1);
  });

  it("[O10] a host that binds no onLifecycle gets the old answer whatever the switch", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { followStatus: true });
    await acceptedOrder(h);

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", DSP));

    expect(outcome).toEqual({ kind: "ignored", reason: "no order body on DSP" });
    expect(statusRows(h)).toHaveLength(0);
  });

  it("settings built by hand, without followStatus, keep the old behaviour", async () => {
    const h = await harness("moved");
    await acceptedOrder(h);
    const payload = ifoodEvent("ext-1", DSP);

    const outcome = await h.engine.deliver({
      clientId: TENANT,
      event: h.engine.normalize("IFOOD", payload)!,
      payload,
      settings: { autoAccept: false, ackSlaSeconds: 300 },
    });

    expect(outcome).toEqual({ kind: "ignored", reason: "no order body on DSP" });
    expect(h.lifecycleCalls).toHaveLength(0);
  });

  it("[O9] followStatus is saved by the bulk call on its own, and read back", async () => {
    const h = createHarness();
    await h.connect();

    const saved = await h.engine.upsertIntegrations({
      clientId: TENANT,
      actorId: "u1",
      rows: [{ provider: "IFOOD", followStatus: false }],
    });

    expect(saved.kind).toBe("saved");
    expect((await h.engine.integrations(TENANT))[0]?.followStatus).toBe(false);
  });
});
