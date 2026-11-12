import { describe, expect, it } from "vitest";

import { IFOOD_CANCELLATION_ANSWER_WINDOW_MS } from "../ifood";
import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/**
 * Request first, cancel on confirm (FUT-4758). For a host that binds
 * `onCancellationConfirmed`, the store's cancellation is a REQUEST: the order
 * stays as it was while the marketplace answers, and the host hears how it
 * ended through the two optional order-port callbacks — confirmed (it runs its
 * cancel then), or failed, REFUSED or TIMEOUT (the order is still the
 * marketplace's, and still acceptable here). A host that binds neither keeps
 * 1.0.0's stamps exactly.
 */

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };
const FIRST = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };

async function placed(h: Harness, externalOrderId = "ext-1"): Promise<string> {
  await h.connect();
  const outcome = await deliverIfood(h, ifoodPlaced(externalOrderId));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  return outcome.orderId;
}

/** An order on the clock whose store asked to cancel, and iFood took the request (202). */
async function requested(h: Harness): Promise<string> {
  const orderId = await placed(h);
  await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });
  await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);
  return orderId;
}

const later = (h: Harness, ms: number) => {
  h.clock.at = new Date(h.clock.at.getTime() + ms);
};

describe("the store's request leaves the order as it was", () => {
  it("keeps the decision AWAITING with the request PENDING, tells the host nothing, and queues one request", async () => {
    const h = createHarness({ cancellationHooks: true });
    const orderId = await placed(h);

    const result = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    expect(result).toMatchObject({ kind: "decided", status: "AWAITING", cancellation: "PENDING", reasonCode: "503" });
    expect(h.acceptance(orderId)).toMatchObject({
      status: "AWAITING",
      acknowledgedAt: null,
      cancellationStatus: "PENDING",
      cancellationFailureReason: null,
    });
    expect(h.refused).toEqual([]);
    expect(h.cancellationConfirmed).toEqual([]);
    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["requestCancellation"]);
  });

  it("refuses an accept, and a second request, while the request waits", async () => {
    const h = createHarness({ cancellationHooks: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    const accept = await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    const again = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "501" });

    expect(accept).toMatchObject({ kind: "stale", reason: "ALREADY_DECIDED" });
    expect(again).toMatchObject({ kind: "stale", reason: "ALREADY_DECIDED" });
    expect(h.accepted).toEqual([]);
    expect(h.acceptance(orderId)?.cancellationReasonCode).toBe("503");
  });

  it("sends no confirm for an accepted order while its cancellation waits, and the sweep re-queues none", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    // Past the retry span but inside the window: the request is still waiting.
    const h = createHarness({ http, cancellationHooks: true, cancellationWindowMs: 60 * 60_000 });
    const orderId = await placed(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);
    later(h, 11 * 60_000);
    const queued = h.enqueued.length;
    await h.engine.sweepOutbound();

    expect(outcome.kind).toBe("skipped");
    expect(h.acceptance(orderId)?.status).toBe("ACCEPTED");
    expect(h.enqueued.slice(queued).map((job) => job.payload.action)).not.toContain("confirm");
  });
});

describe("the marketplace confirms the store's request", () => {
  it("by event: REJECTED and CONFIRMED, and the host hears onCancellationConfirmed once, never onRefused", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await requested(h);
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("REQUESTED");
    expect(h.cancellationConfirmed).toEqual([]);

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));
    await deliverIfood(h, ifoodEvent("ext-1", "CAN", "evt-redelivered"));

    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: "CONFIRMED" });
    expect(h.cancellationConfirmed).toEqual([orderId]);
    expect(h.refused).toEqual([]);
  });

  it("a cancellation the store never asked for is still the marketplace's: onRefused CANCELLED", async () => {
    const h = createHarness({ cancellationHooks: true });
    const orderId = await placed(h);

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(h.refused).toEqual([{ orderId, reason: "CANCELLED" }]);
    expect(h.cancellationConfirmed).toEqual([]);
  });

  it("a host without the callbacks (1.0.0) hears the confirmation as onRefused CANCELLED, as before", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http });
    const orderId = await requested(h);

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(h.refused).toEqual([{ orderId, reason: "CANCELLED" }]);
  });
});

describe("the marketplace refuses the store's request", () => {
  it("by event: FAILED, REFUSED, told once, and the order is acceptable again", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await requested(h);

    await deliverIfood(h, ifoodEvent("ext-1", "CARF"));
    await deliverIfood(h, ifoodEvent("ext-1", "CARF", "evt-redelivered"));

    expect(h.acceptance(orderId)).toMatchObject({
      status: "AWAITING",
      cancellationStatus: "FAILED",
      cancellationFailureReason: "REFUSED",
    });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
    expect((await h.engine.orderStates(TENANT, [orderId])).get(orderId)).toMatchObject({
      cancellation: "FAILED",
      cancellationFailure: "REFUSED",
    });

    const accept = await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    expect(accept).toMatchObject({ kind: "decided", status: "ACCEPTED", cancellation: null });
    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: null, cancellationFailureReason: null });
    expect(h.accepted).toEqual([orderId]);
  });

  it("by the job's 4xx: FAILED, REFUSED, told once", async () => {
    const http = scriptedHttp([TOKEN, { status: 400, body: "cancellation not allowed" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    expect(outcome.kind).toBe("failed");
    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: "FAILED", cancellationFailureReason: "REFUSED" });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
  });

  it("by the last attempt dying: FAILED, REFUSED, told", async () => {
    const http = scriptedHttp(() => {
      throw new Error("socket hang up");
    });
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, LAST);

    expect(h.acceptance(orderId)?.cancellationStatus).toBe("FAILED");
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
  });

  it("a FAILED request may be asked again, and it starts afresh", async () => {
    const http = scriptedHttp([TOKEN, { status: 400, body: "no" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    const again = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "501" });

    expect(again).toMatchObject({ kind: "decided", cancellation: "PENDING", reasonCode: "501" });
    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: "PENDING", cancellationFailureReason: null });
  });
});

describe("the marketplace never answers", () => {
  it("the sweep fails a REQUESTED request past iFood's window as TIMEOUT, once, and not before", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await requested(h);

    later(h, IFOOD_CANCELLATION_ANSWER_WINDOW_MS - 1);
    const early = await h.engine.sweepOutbound();
    later(h, 2);
    const due = await h.engine.sweepOutbound();
    const again = await h.engine.sweepOutbound();

    expect(early.timedOut).toBe(0);
    expect(due.timedOut).toBe(1);
    expect(again.timedOut).toBe(0);
    expect(h.acceptance(orderId)).toMatchObject({
      status: "AWAITING",
      cancellationStatus: "FAILED",
      cancellationFailureReason: "TIMEOUT",
    });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
  });

  it("a PENDING request iFood never received ends at the window too: TIMEOUT, told once, never re-queued or sent after", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true, queueDown: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });
    const queued = h.enqueued.length;

    later(h, IFOOD_CANCELLATION_ANSWER_WINDOW_MS + 1);
    const swept = await h.engine.sweepOutbound();
    later(h, 30 * 60_000);
    const again = await h.engine.sweepOutbound();
    const lateRetry = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    expect(swept.timedOut).toBe(1);
    expect(again).toMatchObject({ timedOut: 0, requeued: 0 });
    expect(h.acceptance(orderId)).toMatchObject({
      status: "AWAITING",
      cancellationStatus: "FAILED",
      cancellationFailureReason: "TIMEOUT",
    });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
    expect(h.enqueued.slice(queued)).toEqual([]);
    expect(lateRetry.kind).toBe("skipped");
    expect(http.requests).toEqual([]);
  });

  it("a retry that runs past the window ends the request TIMEOUT itself, without calling iFood", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    later(h, IFOOD_CANCELLATION_ANSWER_WINDOW_MS + 1);
    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    expect(outcome.kind).toBe("failed");
    expect(http.requests).toEqual([]);
    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: "FAILED", cancellationFailureReason: "TIMEOUT" });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
  });

  it("the engine's cancellationWindowMs overrides the adapter's", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true, cancellationWindowMs: 60_000 });
    const orderId = await requested(h);

    later(h, 60_001);
    const result = await h.engine.sweepOutbound();

    expect(result.timedOut).toBe(1);
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
  });

  it("a confirmation that lands after the timeout still confirms (CONFIRMED is terminal, FAILED is not)", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await requested(h);
    later(h, IFOOD_CANCELLATION_ANSWER_WINDOW_MS + 1);
    await h.engine.sweepOutbound();

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: "CONFIRMED", cancellationFailureReason: null });
    expect(h.cancellationConfirmed).toEqual([orderId]);
  });
});

describe("decide REJECT follows the same rule (the admin route, the MCP's decideMarketplaceOrders)", () => {
  async function rejected(h: Harness): Promise<string> {
    const orderId = await placed(h);
    const decided = await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "503" });
    expect(decided).toMatchObject({ kind: "decided", status: "AWAITING", cancellation: "PENDING" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);
    return orderId;
  }

  it("writes the request only, never onRefused up front, and the confirmation cancels once", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await rejected(h);
    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: "REQUESTED" });
    expect(h.refused).toEqual([]);

    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: "CONFIRMED" });
    expect(h.cancellationConfirmed).toEqual([orderId]);
    expect(h.refused).toEqual([]);
  });

  it("a refusal leaves the order acceptable, told once", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await rejected(h);

    await deliverIfood(h, ifoodEvent("ext-1", "CARF"));
    const accept = await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
    expect(accept).toMatchObject({ kind: "decided", status: "ACCEPTED" });
    expect(h.refused).toEqual([]);
  });

  it("a timeout leaves the order acceptable, told once", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await rejected(h);

    later(h, IFOOD_CANCELLATION_ANSWER_WINDOW_MS + 1);
    await h.engine.sweepOutbound();
    await h.engine.sweepOutbound();

    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationFailureReason: "TIMEOUT" });
    expect(h.refused).toEqual([]);
  });
});

describe("a host that binds no onCancellationConfirmed keeps 1.0.0's behaviour", () => {
  it("decide REJECT and the store's cancel stamp REJECTED at once, and decide calls onRefused then", async () => {
    const h = createHarness();
    const first = await placed(h, "ext-1");
    const second = await placed(h, "ext-2");

    const decided = await h.engine.decide({ clientId: TENANT, orderId: first, decision: "REJECT", reasonCode: "503" });
    const recorded = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId: second, reasonCode: "503" });

    expect(decided).toMatchObject({ status: "REJECTED", cancellation: "PENDING" });
    expect(recorded).toMatchObject({ status: "REJECTED", cancellation: "PENDING" });
    expect(h.acceptance(first)?.status).toBe("REJECTED");
    expect(h.acceptance(second)?.status).toBe("REJECTED");
    expect(h.refused).toEqual([{ orderId: first, reason: "REJECTED" }]);
  });
});

describe("a 1.0.0 host's undelivered request is retried, never timed out", () => {
  it("past iFood's window and the retry span, the sweep re-queues it and stamps nothing", async () => {
    const h = createHarness({ queueDown: true });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    later(h, 10 * 60_000 + 1);
    const result = await h.engine.sweepOutbound();

    // The queue is down, so the re-queue is the attempt itself, under the sweep's own key.
    expect(result).toMatchObject({ timedOut: 0, givenUp: 0 });
    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: "PENDING", cancellationFailureReason: null });
    expect(h.enqueued.at(-1)?.payload).toEqual({ clientId: TENANT, orderId, action: "requestCancellation" });
    expect(h.enqueued.at(-1)?.dedupeKey).toContain(":sweep:");
  });

  it("a retry past the window still sends the request", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http });
    const orderId = await placed(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "503" });

    later(h, IFOOD_CANCELLATION_ANSWER_WINDOW_MS + 1);
    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    expect(outcome).toEqual({ kind: "done", action: "requestCancellation" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("REQUESTED");
  });
});

describe("the acceptance clock leaves a waiting request alone", () => {
  it("an AWAITING order whose request waits is not expired, so the host hears one ending only", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http, cancellationHooks: true, cancellationWindowMs: 60 * 60_000 });
    const orderId = await requested(h);

    later(h, 10 * 60_000);
    const expired = await h.engine.expireLapsed();
    await deliverIfood(h, ifoodEvent("ext-1", "CAN"));

    expect(expired.expired).toBe(0);
    expect(h.refused).toEqual([]);
    expect(h.cancellationConfirmed).toEqual([orderId]);
  });
});
