import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { MARKETPLACE_FETCH_ORDER_JOB, type FetchOrderJobPayload } from "../../core/fetch-order";
import { createNinetyNineFoodAdapter } from "../../99food";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../../99food/en-US";
import { API_BASE as OD_BASE, PORTAL as OD_PORTAL } from "../../99food/__tests__/fixtures";
import { TENANT, createHarness, scriptedHttp, type Harness } from "../../__tests__/harness";
import { createKeetaAdapter, KEETA_CANCELLATION_ANSWER_WINDOW_MS, KEETA_PROVIDER } from "..";
import { KEETA_ADAPTER_COPY_EN_US } from "../en-US";
import { API_BASE, ENCRYPTED, KEETA_DECRYPTED, KEETA_MERCHANT_ID, KEETA_ORDER_ID, keetaEvent, keetaOrder } from "./fixtures";

/**
 * The engine, unchanged, driven through the Keeta adapter end to end: the
 * event → the fetch job (with the decrypt of a merchant bag) → ingest →
 * aceite → confirm → cancellation request → Keeta's answer, or its silence.
 * Keeta is registered beside 99Food, the other Open Delivery adapter, and
 * nothing below names it outside the adapter.
 */

const P = KEETA_PROVIDER;
const ATTEMPT = { attempt: 1, maxAttempts: 3 };
/** The sandbox URL of the example order's resource. */
const orderUrl = (action: string): string => `${API_BASE.SANDBOX}/v1/orders/${KEETA_ORDER_ID}/${action}`;
const TOKEN = { status: 200, body: JSON.stringify({ access_token: "tok", token_type: "bearer", expires_in: 7200 }) };

/** Keeta's API as its documentation describes it. */
function keeta(options: { deliveredBy?: string; decrypt?: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse } = {}) {
  return scriptedHttp((request) => {
    if (request.url.endsWith("/oauth/token")) return TOKEN;
    if (request.url.endsWith("/v1/batchDecrypt")) {
      return options.decrypt?.(request) ?? { status: 200, body: JSON.stringify(KEETA_DECRYPTED) };
    }
    if (request.method === "GET") {
      const id = decodeURIComponent(request.url.split("/").pop() ?? "");
      return { status: 200, body: JSON.stringify(keetaOrder(id, options.deliveredBy)) };
    }
    return { status: 202, body: "" };
  });
}

function harness(http: ReturnType<typeof scriptedHttp> = keeta()) {
  const mounted = createHarness({
    http,
    dedupeQueue: true,
    cancellationHooks: true,
    adapters: [
      createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: OD_BASE, portalUrl: OD_PORTAL }),
      createKeetaAdapter({ copy: KEETA_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE }),
    ],
  });
  return { h: mounted, http };
}

async function deliver(subject: Harness, payload: unknown) {
  const event = subject.engine.normalize(P, payload);
  if (!event) throw new Error("did not normalize");
  const target = await subject.engine.target(TENANT, P);
  return subject.engine.deliver({
    clientId: TENANT,
    event,
    payload,
    settings: target?.enabled ? { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds } : null,
  });
}

async function connect(subject: Harness) {
  await subject.connect(P);
  subject.patchIntegration({ externalMerchantId: KEETA_MERCHANT_ID });
}

/** CREATED → the fetch job → an ingested order's host id. */
async function arrive(subject: Harness): Promise<string> {
  await deliver(subject, keetaEvent("CREATED"));
  const job = subject.queued.filter((queued) => queued.name === MARKETPLACE_FETCH_ORDER_JOB).at(-1);
  if (!job) throw new Error("no fetch queued");
  const outcome = await subject.engine.runFetchOrder(job.payload as unknown as FetchOrderJobPayload, ATTEMPT);
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  return outcome.orderId;
}

describe("the engine through the Keeta adapter, end to end", () => {
  it("registers beside 99Food on the same engine", () => {
    const { h } = harness();
    expect(h.engine.providers()).toEqual(["NINETY_NINE_FOOD", P]);
    expect(h.engine.reasons(P)).toHaveLength(11);
    expect(h.engine.adapter(P)?.catalogue?.mode).toBe("pull");
  });

  it("fetches the order, decrypts a merchant bag's personal data, and ingests the documented totals", async () => {
    const { h, http } = harness();
    await connect(h);
    await arrive(h);

    expect(http.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${API_BASE.SANDBOX}/oauth/token`,
      `GET ${API_BASE.SANDBOX}/v1/orders/${KEETA_ORDER_ID}`,
      `POST ${API_BASE.SANDBOX}/v1/batchDecrypt`,
    ]);
    expect(JSON.parse(http.requests[2]?.body ?? "{}").cipherInfos).toHaveLength(5);
    const created = h.created[0]?.order;
    expect(created).toMatchObject({
      provider: P,
      externalDisplayId: "4821",
      externalMerchantId: KEETA_MERCHANT_ID,
      totalCents: 5159,
      commissionCents: null,
      deliveredBy: "MERCHANT",
      buyer: { name: "Mariana", phone: "+55 11 98765-4321" },
      deliveryAddress: {
        street: "Rua Domingos de Morais",
        number: "1200",
        neighborhood: "Vila Mariana",
        complement: "Apto 12",
        postalCode: "04010100",
        state: "SP",
      },
    });
    // 35.60 over 4 is 8.90 each; the lines add up to the items' 48.60.
    expect(created?.lines.map((line) => [line.externalSku, line.quantity, line.unitPriceCents])).toEqual([
      ["PDV-1001", 4, 890],
      ["PDV-3005", 2, 650],
    ]);
    expect(JSON.stringify(created)).not.toContain("ENC_");
  });

  it("never decrypts on Keeta's own fleet: the masked values are dropped, never shown", async () => {
    const { h, http } = harness(keeta({ deliveredBy: "MARKETPLACE" }));
    await connect(h);
    await arrive(h);

    expect(http.requests.some((r) => r.url.endsWith("/v1/batchDecrypt"))).toBe(false);
    expect(h.created[0]?.order).toMatchObject({
      buyer: { phone: null },
      deliveryAddress: { number: "no number", neighborhood: "", complement: null },
    });
    expect(JSON.stringify(h.created[0]?.order)).not.toContain("ENC_");
  });

  it("a failed decrypt still ingests the order, with the masked values dropped", async () => {
    const { h } = harness(keeta({ decrypt: () => ({ status: 503, body: "busy" }) }));
    await connect(h);
    await arrive(h);

    expect(h.created[0]?.order.deliveryAddress?.number).toBe("no number");
    expect(JSON.stringify(h.created[0]?.order)).not.toContain(ENCRYPTED.phone);
  });

  it("the aceite sends the signed confirm", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    expect(await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, ATTEMPT)).toEqual({
      kind: "done",
      action: "confirm",
    });
    const confirm = http.requests.at(-1);
    expect(confirm?.url).toBe(orderUrl("confirm"));
    expect(confirm?.headers["X-App-Signature"]).toEqual(expect.any(String));
  });

  it("a refusal sends the cancellation request; Keeta's CANCELLED confirms it", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h);

    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "UNAVAILABLE_ITEM" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);
    expect(http.requests.at(-1)?.url).toBe(orderUrl("requestCancellation"));
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("REQUESTED");

    expect(await deliver(h, keetaEvent("CANCELLATION_REQUESTED"))).toMatchObject({ kind: "ignored" });
    expect(await deliver(h, keetaEvent("CANCELLED"))).toEqual({ kind: "cancelled" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("CONFIRMED");
    expect(h.cancellationConfirmed).toEqual([orderId]);
  });

  it("a request Keeta never grants (no denial event exists) fails as TIMEOUT once the answer window passes", async () => {
    const { h } = harness();
    await connect(h);
    const orderId = await arrive(h);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "OUTSIDE_DELIVERY_HOURS" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    h.clock.at = new Date(h.clock.at.getTime() + KEETA_CANCELLATION_ANSWER_WINDOW_MS + 1);
    expect(await h.engine.sweepOutbound()).toMatchObject({ timedOut: 1 });

    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: "FAILED", cancellationFailureReason: "TIMEOUT" });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
  });
});
