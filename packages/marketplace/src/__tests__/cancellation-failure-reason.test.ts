import { describe, expect, it } from "vitest";

import { TENANT, createHarness, deliverIfood, ifoodEvent, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/**
 * Why the store's cancellation request FAILED (FUT-4917), at the engine through
 * iFood's wire shapes: REFUSED is the marketplace's judgement (its CARF event,
 * a final 4xx on the request: iFood cannot tell a business 4xx from a
 * malformed one); UNREACHABLE is our own request never getting one (no
 * credentials, ones that do not open, a token not granted, retries that ran
 * out); TIMEOUT is covered by `cancel-on-confirm.test.ts`.
 */

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };
const FIRST = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };

async function requestPending(h: Harness): Promise<string> {
  await h.connect();
  const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  await h.engine.recordStoreCancellation({ clientId: TENANT, orderId: outcome.orderId, reasonCode: "503" });
  return outcome.orderId;
}

async function failedWith(h: Harness, orderId: string, attempt = FIRST) {
  await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, attempt);
  return { stored: h.acceptance(orderId)?.cancellationFailureReason, told: h.cancellationFailed };
}

describe("a cancellation request that FAILS says whose failure it was", () => {
  it("the marketplace's CARF event is REFUSED", async () => {
    const h = createHarness({ http: scriptedHttp([TOKEN, { status: 202, body: "" }]), cancellationHooks: true });
    const orderId = await requestPending(h);
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    await deliverIfood(h, ifoodEvent("ext-1", "CARF"));

    expect(h.acceptance(orderId)?.cancellationFailureReason).toBe("REFUSED");
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
  });

  it("a final 4xx on the request itself is REFUSED (iFood cannot tell a business 4xx from a malformed one)", async () => {
    const h = createHarness({ http: scriptedHttp([TOKEN, { status: 400, body: "invalid uuid" }]), cancellationHooks: true });
    const orderId = await requestPending(h);

    expect(await failedWith(h, orderId)).toEqual({ stored: "REFUSED", told: [{ orderId, reason: "REFUSED" }] });
  });

  it("no credentials on file is UNREACHABLE, and nothing is sent", async () => {
    const http = scriptedHttp([TOKEN]);
    const h = createHarness({ http, cancellationHooks: true });
    const orderId = await requestPending(h);
    h.patchIntegration({ credentials: null });

    expect(await failedWith(h, orderId)).toEqual({ stored: "UNREACHABLE", told: [{ orderId, reason: "UNREACHABLE" }] });
    expect(http.requests).toEqual([]);
  });

  it("credentials that do not open are UNREACHABLE", async () => {
    const h = createHarness({ http: scriptedHttp([TOKEN]), cancellationHooks: true });
    const orderId = await requestPending(h);
    h.patchIntegration({ credentials: "not-sealed" });

    expect(await failedWith(h, orderId)).toEqual({ stored: "UNREACHABLE", told: [{ orderId, reason: "UNREACHABLE" }] });
  });

  it("a token grant iFood refuses (401) is UNREACHABLE: no judgement of the order was reached", async () => {
    const h = createHarness({ http: scriptedHttp([{ status: 401, body: "invalid client" }]), cancellationHooks: true });
    const orderId = await requestPending(h);

    expect(await failedWith(h, orderId)).toEqual({ stored: "UNREACHABLE", told: [{ orderId, reason: "UNREACHABLE" }] });
  });

  it("a 5xx on the last attempt is UNREACHABLE, and an earlier attempt tells nobody", async () => {
    const h = createHarness({ http: scriptedHttp([TOKEN, { status: 503, body: "busy" }]), cancellationHooks: true });
    const orderId = await requestPending(h);

    await expect(h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST)).rejects.toThrow();
    expect(h.cancellationFailed).toEqual([]);
    expect(await failedWith(h, orderId, LAST)).toEqual({ stored: "UNREACHABLE", told: [{ orderId, reason: "UNREACHABLE" }] });
  });
});
