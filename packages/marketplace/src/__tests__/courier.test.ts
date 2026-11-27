import { describe, expect, it } from "vitest";

import { OutboundRetryError } from "../core/outbound";
import type { OutboundJobPayload } from "../core/outbound-queue";
import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/* eslint-disable test-flakiness/no-test-isolation --
   Every case builds its OWN harness (`createHarness`) inside the case, and its
   engine, database and queue are local to it: the rule reads a call on that
   local (`h.patchAcceptance(...)`) as a write to shared state. */

/**
 * The engine's half of FUT-5665: iFood's courier events reach the host's
 * `onCourier`; `COLLECTED` joins `DISPATCHED` in the lifecycle rule (FUT-4653);
 * the pickup code is checked with iFood by the `marketplace.outbound` job,
 * action `validatePickupCode`; and `courierTracking` reads iFood's tracking.
 */

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };
const FIRST = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };
const API = "https://merchant-api.ifood.com.br/order/v1.0/orders/ext-1";

/** A connected tenant whose order is ingested and accepted; the order id comes back. */
async function acceptedOrder(h: Harness, deliveredBy: "MERCHANT" | "MARKETPLACE" | null = "MARKETPLACE"): Promise<string> {
  await h.connect();
  const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });
  h.patchAcceptance(outcome.orderId, { deliveredBy });
  return outcome.orderId;
}

function inboxRow(h: Harness, eventId: string): Record<string, unknown> | undefined {
  return h.memory.tables.marketplaceInboxEvent.rows.find((row) => row.eventId === eventId);
}

function assigned(orderId = "ext-1") {
  return {
    ...ifoodEvent(orderId, "ADR"),
    createdAt: "2026-11-11T11:58:00.000Z",
    metadata: { workerName: "Carlos", workerPhotoUrl: "https://cdn.ifood.com.br/w.jpg", workerVehicleType: "MOTORCYCLE" },
  };
}

describe("a courier event reaches the host", () => {
  it("ASSIGN_DRIVER: the host records who is coming; the row is PROCESSED and the staff told", async () => {
    const h = createHarness({ courier: ["recorded"] });
    const orderId = await acceptedOrder(h);

    const outcome = await deliverIfood(h, assigned());

    expect(outcome).toEqual({ kind: "courier", orderId, step: "ASSIGNED" });
    expect(h.courierCalls).toEqual([
      {
        orderId,
        event: {
          step: "ASSIGNED",
          at: new Date("2026-11-11T11:58:00.000Z"),
          courier: { name: "Carlos", photoUrl: "https://cdn.ifood.com.br/w.jpg", vehicle: "MOTORCYCLE" },
          returning: null,
        },
        facts: { deliveredBy: "MARKETPLACE", at: new Date("2026-11-11T11:58:00.000Z") },
      },
    ]);
    expect(inboxRow(h, "evt-ext-1-ADR")).toMatchObject({ status: "PROCESSED" });
    expect(h.published).toContain(TENANT);
    expect(h.http.requests).toHaveLength(0);
  });

  it("an event that states no instant is handed the engine's clock", async () => {
    const h = createHarness({ courier: ["recorded"] });
    await acceptedOrder(h);

    await deliverIfood(h, ifoodEvent("ext-1", "AAO"));

    expect(h.courierCalls[0]?.facts.at).toEqual(h.clock.at);
    expect(h.courierCalls[0]?.event.step).toBe("ARRIVED_AT_ORIGIN");
  });

  it("the bag coming back is a fact; nothing moves", async () => {
    const h = createHarness({ courier: ["recorded"], lifecycle: ["moved"] });
    await acceptedOrder(h);

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", "DELIVERY_RETURNING_TO_ORIGIN"));

    expect(outcome).toMatchObject({ kind: "courier", step: "RETURNING_TO_ORIGIN" });
    expect(h.courierCalls[0]?.event.returning).toBe("RETURNING");
    expect(h.lifecycleCalls).toHaveLength(0);
  });

  it("unchanged with the host's reason: IGNORED with it", async () => {
    const h = createHarness({ courier: [{ kind: "unchanged", reason: "a merchant bag has no iFood courier" }] });
    await acceptedOrder(h, "MERCHANT");

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", "GTO"));

    expect(outcome).toEqual({ kind: "ignored", reason: "a merchant bag has no iFood courier" });
    expect(inboxRow(h, "evt-ext-1-GTO")).toMatchObject({ status: "IGNORED", error: "a merchant bag has no iFood courier" });
  });

  it("an order the store has not accepted is never handed over to the host", async () => {
    const h = createHarness({ courier: ["recorded"] });
    await h.connect();
    await deliverIfood(h, ifoodPlaced("ext-1"));

    const outcome = await deliverIfood(h, assigned());

    expect(outcome).toEqual({ kind: "ignored", reason: "the order is AWAITING, not ACCEPTED" });
    expect(h.courierCalls).toHaveLength(0);
  });

  it("an event before its order is deferred PENDING, and the reconcile pass applies it", async () => {
    const h = createHarness({ courier: ["recorded"] });
    await h.connect();

    const early = await deliverIfood(h, assigned());
    expect(early).toEqual({ kind: "ignored", reason: "courier event before its order" });
    expect(inboxRow(h, "evt-ext-1-ADR")).toMatchObject({ status: "PENDING", attempts: 1 });

    const placed = await deliverIfood(h, ifoodPlaced("ext-1"));
    if (placed.kind !== "ingested") throw new Error(placed.kind);
    await h.engine.decide({ clientId: TENANT, orderId: placed.orderId, decision: "ACCEPT" });
    const pending = (await h.engine.retryable()).filter((row) => row.id === inboxRow(h, "evt-ext-1-ADR")?.id);
    const outcomes = await Promise.all(pending.map((row) => h.engine.reprocess(row)));

    expect(outcomes).toEqual([{ kind: "courier", orderId: placed.orderId, step: "ASSIGNED" }]);
  });

  it("a host that binds no onCourier gets the old answer", async () => {
    const h = createHarness();
    await acceptedOrder(h);

    expect(await deliverIfood(h, assigned())).toEqual({ kind: "ignored", reason: "no order body on ADR" });
  });
});

describe("COLLECTED joins DISPATCHED in the lifecycle rule (FUT-4653)", () => {
  it("a fleet bag at CLT moves forward through onLifecycle, noted as the marketplace's hand-over", async () => {
    const h = createHarness({ lifecycle: ["moved"], courier: ["recorded"] });
    const orderId = await acceptedOrder(h);

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", "CLT"));

    expect(outcome).toEqual({ kind: "moved", orderId, lifecycle: "COLLECTED" });
    expect(h.courierCalls.map((c) => c.event.step)).toEqual(["COLLECTED"]);
    expect(h.lifecycleCalls[0]).toMatchObject({ orderId, event: { lifecycle: "COLLECTED" }, facts: { deliveredBy: "MARKETPLACE" } });
    expect(h.memory.tables.marketplaceStatusUpdate.rows).toEqual([
      expect.objectContaining({ orderId, step: "HANDED_OVER", source: "MARKETPLACE", state: "NOTED" }),
    ]);
    expect(inboxRow(h, "evt-ext-1-CLT")).toMatchObject({ status: "PROCESSED" });
  });

  it("with no courier hook the CLT still moves the bag, as a DSP does", async () => {
    const h = createHarness({ lifecycle: ["moved"] });
    const orderId = await acceptedOrder(h);

    expect(await deliverIfood(h, ifoodEvent("ext-1", "COLLECTED"))).toEqual({ kind: "moved", orderId, lifecycle: "COLLECTED" });
  });

  it("a DSP after the CLT is the host's to judge: already there, unchanged", async () => {
    const h = createHarness({ lifecycle: ["moved", "unchanged"] });
    await acceptedOrder(h);

    await deliverIfood(h, ifoodEvent("ext-1", "CLT"));
    const dsp = await deliverIfood(h, ifoodEvent("ext-1", "DSP"));

    expect(dsp).toEqual({ kind: "ignored", reason: "already at or past DISPATCHED" });
    expect(h.memory.tables.marketplaceStatusUpdate.rows.map((r) => r.step).sort()).toEqual(["DISPATCHED", "HANDED_OVER"]);
  });

  it("a CLT after our own HANDED_OVER is an echo and moves nothing; the courier's facts are still recorded", async () => {
    const h = createHarness({ lifecycle: ["moved"], courier: ["recorded"] });
    const orderId = await acceptedOrder(h);
    await h.seedStatus({ orderId, step: "HANDED_OVER", source: "STORE", state: "SENT" });

    const outcome = await deliverIfood(h, ifoodEvent("ext-1", "CLT"));

    expect(h.lifecycleCalls).toHaveLength(0);
    expect(outcome).toEqual({ kind: "courier", orderId, step: "COLLECTED" });
    expect(inboxRow(h, "evt-ext-1-CLT")).toMatchObject({ status: "PROCESSED" });
  });

  it("with the switch OFF, a CLT moves nothing and still reaches onCourier", async () => {
    const h = createHarness({ lifecycle: ["moved"], courier: ["recorded"] });
    const orderId = await acceptedOrder(h);
    h.patchIntegration({ followStatus: false });

    expect(await deliverIfood(h, ifoodEvent("ext-1", "CLT"))).toEqual({ kind: "courier", orderId, step: "COLLECTED" });
    expect(h.lifecycleCalls).toHaveLength(0);
  });
});

const job = (orderId: string, code = "4821"): OutboundJobPayload => ({ clientId: TENANT, orderId, action: "validatePickupCode", code });

function answering(body: string | (() => Promise<never>), status = 200) {
  return scriptedHttp((request) => {
    if (request.url.endsWith("/token")) return TOKEN;
    return typeof body === "function" ? body() : { status, body };
  });
}

describe("validatePickupCode: the host's one enqueue", () => {
  it("queues the job under the hand-over's own key, with the code", async () => {
    const h = createHarness();
    const at = new Date("2026-11-11T12:01:00.000Z");

    expect(await h.engine.validatePickupCode({ clientId: TENANT, orderId: "o1", code: "4821", at })).toBe(true);
    expect(h.enqueued).toEqual([
      {
        name: "marketplace.outbound",
        payload: { clientId: TENANT, orderId: "o1", action: "validatePickupCode", code: "4821" },
        dedupeKey: `marketplace.outbound:validatePickupCode:o1:${at.getTime()}`,
        delayMs: undefined,
      },
    ]);
  });

  it("never throws: a queue that refuses is logged and answers false", async () => {
    const h = createHarness({ queueDown: true });
    expect(await h.engine.validatePickupCode({ clientId: TENANT, orderId: "o1", code: "1", at: new Date(1) })).toBe(false);
    expect(h.logged.some((line) => line.level === "warn" && line.message.includes("validatePickupCode"))).toBe(true);
  });
});

describe("the validatePickupCode job", () => {
  it("valid: true reaches the host as VALID, one call", async () => {
    const http = answering('{"valid":true}');
    const h = createHarness({ http, pickupCodeHook: true });
    const orderId = await acceptedOrder(h);

    const outcome = await h.engine.runOutbound(job(orderId), FIRST);

    expect(outcome).toEqual({ kind: "done", action: "validatePickupCode" });
    expect(h.pickupCodeVerdicts).toEqual([{ orderId, validation: "VALID" }]);
    expect(http.requests.filter((r) => !r.url.endsWith("/token")).map((r) => `${r.method} ${r.url} ${r.body}`)).toEqual([
      `POST ${API}/validatePickupCode {"code":"4821"}`,
    ]);
  });

  it("valid: false reaches the host as INVALID: the job is done, nothing else moves", async () => {
    const h = createHarness({ http: answering('{"valid":false}'), pickupCodeHook: true });
    const orderId = await acceptedOrder(h);
    const before = { ...h.acceptance(orderId) };

    expect(await h.engine.runOutbound(job(orderId, "0000"), FIRST)).toEqual({ kind: "done", action: "validatePickupCode" });
    expect(h.pickupCodeVerdicts).toEqual([{ orderId, validation: "INVALID" }]);
    expect(h.acceptance(orderId)).toEqual(before);
  });

  it("a 4xx is final: UNVERIFIED, logged at error, never retried", async () => {
    const h = createHarness({ http: answering("PickupCodeDisabled", 400), pickupCodeHook: true });
    const orderId = await acceptedOrder(h);

    const outcome = await h.engine.runOutbound(job(orderId), FIRST);

    expect(outcome).toMatchObject({ kind: "failed", action: "validatePickupCode", reason: "refused 400: PickupCodeDisabled" });
    expect(h.pickupCodeVerdicts).toEqual([{ orderId, validation: "UNVERIFIED" }]);
    expect(h.logged.some((line) => line.level === "error")).toBe(true);
  });

  it("a timeout is retried until the last attempt, which tells the host UNVERIFIED", async () => {
    const h = createHarness({ http: answering(() => Promise.reject(new Error("timeout"))), pickupCodeHook: true });
    const orderId = await acceptedOrder(h);

    await expect(h.engine.runOutbound(job(orderId), FIRST)).rejects.toBeInstanceOf(OutboundRetryError);
    expect(h.pickupCodeVerdicts).toHaveLength(0);

    expect(await h.engine.runOutbound(job(orderId), LAST)).toMatchObject({ kind: "failed", reason: "timeout" });
    expect(h.pickupCodeVerdicts).toEqual([{ orderId, validation: "UNVERIFIED" }]);
  });

  it("a host verdict half that throws is logged; the job is still done", async () => {
    const h = createHarness({ http: answering('{"valid":true}'), pickupCodeHook: "throw" });
    const orderId = await acceptedOrder(h);

    expect(await h.engine.runOutbound(job(orderId), FIRST)).toEqual({ kind: "done", action: "validatePickupCode" });
    expect(h.logged.some((line) => line.level === "error" && line.message.includes("pickup-code verdict"))).toBe(true);
  });

  it("skips, with no call, a merchant bag, an order no longer ACCEPTED and an empty code", async () => {
    const http = answering('{"valid":true}');
    const merchant = createHarness({ http, pickupCodeHook: true });
    const orderId = await acceptedOrder(merchant, "MERCHANT");
    expect(await merchant.engine.runOutbound(job(orderId), FIRST)).toEqual({
      kind: "skipped",
      reason: "the order is not carried by the marketplace's courier",
    });

    merchant.patchAcceptance(orderId, { deliveredBy: "MARKETPLACE", status: "REJECTED" });
    expect(await merchant.engine.runOutbound(job(orderId), FIRST)).toMatchObject({ kind: "skipped", reason: "the order is REJECTED, not ACCEPTED" });

    merchant.patchAcceptance(orderId, { status: "ACCEPTED" });
    expect(await merchant.engine.runOutbound(job(orderId, ""), FIRST)).toEqual({ kind: "skipped", reason: "no pickup code to send" });
    expect(http.requests).toHaveLength(0);
    expect(merchant.pickupCodeVerdicts).toHaveLength(0);
  });
});

describe("courierTracking", () => {
  it("200: the reading, from one GET", async () => {
    const http = answering(JSON.stringify({ pickupEtaStart: 120, trackDate: "2026-11-11T12:00:00.000Z" }));
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h);

    const result = await h.engine.courierTracking({ clientId: TENANT, orderId });

    expect(result).toMatchObject({ kind: "tracking", tracking: { pickupEtaAt: new Date("2026-11-11T12:02:00.000Z") } });
    expect(http.requests.filter((r) => !r.url.endsWith("/token")).map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${API}/tracking`]);
  });

  it("404 before ASSIGN_DRIVER: not yet", async () => {
    const h = createHarness({ http: answering("", 404) });
    const orderId = await acceptedOrder(h);

    expect(await h.engine.courierTracking({ clientId: TENANT, orderId })).toEqual({ kind: "notYet" });
  });

  it("unsupported, with no call, for a merchant bag or an order the engine does not hold", async () => {
    const http = answering("{}");
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h, "MERCHANT");

    expect(await h.engine.courierTracking({ clientId: TENANT, orderId })).toMatchObject({ kind: "unsupported" });
    expect(await h.engine.courierTracking({ clientId: TENANT, orderId: "nope" })).toMatchObject({ kind: "unsupported" });
    expect(http.requests).toHaveLength(0);
  });
});
