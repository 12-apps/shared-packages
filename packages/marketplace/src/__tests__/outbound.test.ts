import { describe, expect, it } from "vitest";

import { OutboundRetryError } from "../core/outbound";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/**
 * The outbound engine's rows (I1 contract §1, J1–J6): the job re-reads the
 * row, calls through the adapter with the host's HTTP client, and stamps the
 * outcome. 2xx done, 4xx refused and final, anything else retried until the
 * last attempt. The HTTP client is a scripted fake; nothing leaves the process.
 */

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };
const FIRST = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };

async function acceptedOrder(h: Harness): Promise<string> {
  await h.connect();
  const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });
  return outcome.orderId;
}

async function refusedOrder(h: Harness, code = "503"): Promise<string> {
  await h.connect();
  const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "REJECT", reasonCode: code });
  return outcome.orderId;
}

describe("the confirm", () => {
  it("[J1] confirms once, stamps confirmed_at, and a second run calls nothing", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h);

    const first = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);
    const second = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);

    expect(first).toEqual({ kind: "done", action: "confirm" });
    expect(second.kind).toBe("skipped");
    expect(http.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token",
      "POST https://merchant-api.ifood.com.br/order/v1.0/orders/ext-1/confirm",
    ]);
    expect(http.requests[1]?.headers.Authorization).toBe("Bearer tok-1");
    expect(h.acceptance(orderId)?.confirmedAt).toEqual(h.clock.at);
  });

  it("[J6] sends no confirm for an order cancelled here after it was accepted", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "509" });

    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);

    expect(outcome.kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
  });

  it("stamps confirm_failed_at on a 4xx and does not retry", async () => {
    const http = scriptedHttp([TOKEN, { status: 409, body: "order already concluded" }]);
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h);

    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);

    expect(outcome).toMatchObject({ kind: "failed", action: "confirm" });
    expect(h.acceptance(orderId)).toMatchObject({ confirmedAt: null, confirmFailedAt: h.clock.at });
    expect(h.logged.some((line) => line.level === "error")).toBe(true);
  });

  it("refuses for good when the store has no credentials on file, calling nothing", async () => {
    const http = scriptedHttp([TOKEN]);
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h);
    h.patchIntegration({ credentials: "" });

    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);

    expect(outcome.kind).toBe("failed");
    expect(http.requests).toHaveLength(0);
  });

  it("reuses a cached token across orders, and never writes it to a row", async () => {
    const http = scriptedHttp((request) => (request.url.endsWith("/token") ? TOKEN : { status: 202, body: "" }));
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h);
    const second = await deliverIfood(h, ifoodPlaced("ext-2"));
    if (second.kind !== "ingested") throw new Error(second.kind);
    await h.engine.decide({ clientId: TENANT, orderId: second.orderId, decision: "ACCEPT" });

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);
    await h.engine.runOutbound({ clientId: TENANT, orderId: second.orderId, action: "confirm" }, FIRST);

    expect(http.requests.filter((r) => r.url.endsWith("/token"))).toHaveLength(1);
    const everything = JSON.stringify(Object.values(h.memory.tables).map((table) => table.rows));
    expect(everything).not.toContain("tok-1");
  });
});

describe("the cancellation request", () => {
  it("[J2] sends the stored code once, REQUESTED after the 202, and a second run calls nothing", async () => {
    const http = scriptedHttp([TOKEN, { status: 202, body: "" }]);
    const h = createHarness({ http });
    const orderId = await refusedOrder(h, "503");

    const first = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);
    const second = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    expect(first).toEqual({ kind: "done", action: "requestCancellation" });
    expect(second.kind).toBe("skipped");
    const call = http.requests[1];
    expect(call?.url).toBe("https://merchant-api.ifood.com.br/order/v1.0/orders/ext-1/requestCancellation");
    expect(JSON.parse(call?.body ?? "{}")).toEqual({ reason: "Item unavailable", cancellationCode: "503" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("REQUESTED");
  });

  it("[J3] marks FAILED on a 400 and resolves: a refusal is never retried", async () => {
    const http = scriptedHttp([TOKEN, { status: 400, body: "code not allowed for this order" }]);
    const h = createHarness({ http });
    const orderId = await refusedOrder(h);

    const outcome = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST);

    expect(outcome.kind).toBe("failed");
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("FAILED");
    const state = (await h.engine.orderStates(TENANT, [orderId])).get(orderId);
    expect(state).toMatchObject({ cancellation: "FAILED", appUrl: expect.stringMatching(/^https:\/\//) });
  });

  it("[J4] throws to retry a 503 and leaves PENDING, then marks FAILED on the last attempt", async () => {
    const http = scriptedHttp((request) =>
      request.url.endsWith("/token") ? TOKEN : { status: 503, body: "unavailable" },
    );
    const h = createHarness({ http });
    const orderId = await refusedOrder(h);
    const payload = { clientId: TENANT, orderId, action: "requestCancellation" as const };

    await expect(h.engine.runOutbound(payload, FIRST)).rejects.toBeInstanceOf(OutboundRetryError);
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("PENDING");

    const last = await h.engine.runOutbound(payload, LAST);
    expect(last.kind).toBe("failed");
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("FAILED");
  });

  it("treats a network error like a 5xx: retried, never final before the last attempt", async () => {
    const h = createHarness({
      http: {
        requests: [],
        http: async () => {
          throw new Error("ECONNRESET");
        },
      },
    });
    const orderId = await refusedOrder(h);

    await expect(
      h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, FIRST),
    ).rejects.toThrow(/ECONNRESET/);
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("PENDING");
  });

  it("drops a stale token on a 401 so the retry fetches another", async () => {
    const grants: string[] = [];
    const http = scriptedHttp((request) => {
      if (request.url.endsWith("/token")) {
        grants.push(`tok-${grants.length + 1}`);
        return { status: 200, body: JSON.stringify({ accessToken: grants.at(-1), expiresIn: 3600 }) };
      }
      return request.headers.Authorization === "Bearer tok-1" ? { status: 401, body: "" } : { status: 202, body: "" };
    });
    const h = createHarness({ http });
    const orderId = await refusedOrder(h);
    const payload = { clientId: TENANT, orderId, action: "requestCancellation" as const };

    await expect(h.engine.runOutbound(payload, FIRST)).rejects.toBeInstanceOf(OutboundRetryError);
    expect(await h.engine.runOutbound(payload, { attempt: 2, maxAttempts: 3 })).toEqual({
      kind: "done",
      action: "requestCancellation",
    });
    expect(grants).toHaveLength(2);
  });

  it("skips an order with no acceptance at all", async () => {
    const h = createHarness();
    expect(
      await h.engine.runOutbound({ clientId: TENANT, orderId: "nope", action: "confirm" }, FIRST),
    ).toMatchObject({ kind: "skipped" });
  });
});
