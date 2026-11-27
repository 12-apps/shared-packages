import { describe, expect, it } from "vitest";

import { createIfoodAdapter } from "..";
import type { AdapterCallContext, MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { IFOOD_ADAPTER_COPY_EN_US } from "../en-US";
import { IFOOD_COURIER } from "../courier";
import { ifoodPlacedWithMoney } from "./fixtures";

/**
 * iFood's own fleet (FUT-5665), the adapter's half: the courier events of
 * iFood's stream (research lines 95-108), `delivery.pickupCode` (line 87),
 * `validatePickupCode` (lines 110-112) and `GET /tracking` (lines 113-115).
 * Every fixture is the shape the research quotes from iFood's Order module.
 */

/** The adapter's normalizer, built per call. */
const normalize = (payload: unknown) => createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }).normalize(payload);
const API = "https://merchant-api.ifood.com.br/order/v1.0/orders/ord-1";
const NOW = new Date("2026-11-26T18:00:00.000Z");

/** An iFood courier event as the stream delivers it. */
function courierEvent(code: string, metadata?: unknown) {
  return {
    id: `evt-${code}`,
    code,
    orderId: "ord-1",
    merchantId: "merch-1",
    createdAt: "2026-11-26T17:55:00.000Z",
    ...(metadata === undefined ? {} : { metadata }),
  };
}

describe("the courier events", () => {
  it("ASSIGN_DRIVER names who is coming: name, https photo, vehicle", () => {
    const event = normalize(
      courierEvent("ADR", {
        workerName: "Carlos",
        workerPhotoUrl: "https://static.ifood.com.br/worker/42.jpg",
        workerVehicleType: "MOTORCYCLE",
        deliveryId: "del-1",
      }),
    );

    expect(event?.courier).toEqual({
      step: "ASSIGNED",
      at: new Date("2026-11-26T17:55:00.000Z"),
      courier: { name: "Carlos", photoUrl: "https://static.ifood.com.br/worker/42.jpg", vehicle: "MOTORCYCLE" },
      returning: null,
    });
    expect(event?.lifecycle ?? null).toBeNull();
    expect(event?.order).toBeNull();
  });

  it("drops a photo that is not https, reads a JSON-string metadata, and calls an unknown vehicle OTHER", () => {
    const event = normalize(
      courierEvent("ASSIGN_DRIVER", JSON.stringify({ workerName: "Ana", workerPhotoUrl: "javascript:alert(1)", workerVehicleType: "scooter" })),
    );

    expect(event?.courier?.courier).toEqual({ name: "Ana", photoUrl: null, vehicle: "OTHER" });
  });

  it("an ASSIGN_DRIVER with no metadata names nobody", () => {
    expect(normalize(courierEvent("ADR"))?.courier).toMatchObject({ step: "ASSIGNED", courier: null });
  });

  it("maps every courier code, short and long, and only COLLECTED names a lifecycle", () => {
    const cases: [string, string, string | null, string | null][] = [
      ["GTO", "GOING_TO_ORIGIN", null, null],
      ["GOING_TO_ORIGIN", "GOING_TO_ORIGIN", null, null],
      ["AAO", "ARRIVED_AT_ORIGIN", null, null],
      ["ARRIVED_AT_ORIGIN", "ARRIVED_AT_ORIGIN", null, null],
      ["CLT", "COLLECTED", "COLLECTED", null],
      ["COLLECTED", "COLLECTED", "COLLECTED", null],
      ["DELIVERY_RETURNING_TO_ORIGIN", "RETURNING_TO_ORIGIN", null, "RETURNING"],
      ["DELIVERY_RETURNED_TO_ORIGIN", "RETURNED_TO_ORIGIN", null, "RETURNED"],
    ];
    for (const [code, step, lifecycle, returning] of cases) {
      const event = normalize(courierEvent(code));
      expect(event?.courier, code).toMatchObject({ step, courier: null, returning });
      expect(event?.lifecycle ?? null, code).toBe(lifecycle);
    }
  });

  it("other events name no courier step", () => {
    for (const code of ["PLC", "CFM", "DSP", "CON", "AAD", "DELIVERY_RETURN_CODE_REQUESTED"]) {
      expect(normalize(courierEvent(code))?.courier ?? null, code).toBeNull();
    }
  });
});

describe("the pickup code on the order", () => {
  it("is ingested from delivery.pickupCode", () => {
    const payload = ifoodPlacedWithMoney();
    const delivery = { ...payload.order.delivery, pickupCode: "4821" };
    const event = normalize({ ...payload, order: { ...payload.order, delivery } });

    expect(event?.order?.pickupCode).toBe("4821");
    expect(event?.order?.deliveredBy).toBe("MARKETPLACE");
  });

  it("is null when iFood asks none", () => {
    expect(normalize(ifoodPlacedWithMoney())?.order?.pickupCode).toBeNull();
  });
});

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };

function context(answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse | Promise<MarketplaceHttpResponse>) {
  const requests: MarketplaceHttpRequest[] = [];
  const ctx: AdapterCallContext = {
    http: async (request) => {
      requests.push(request);
      return request.url.endsWith("/token") ? TOKEN : answer(request);
    },
    credentials: { clientId: "app", clientSecret: "secret", webhookSecret: null },
    environment: "SANDBOX",
    tokens: new Map(),
    now: NOW,
  };
  return { ctx, calls: () => requests.filter((r) => !r.url.endsWith("/token")) };
}

const ORDER = { externalOrderId: "ord-1", externalDisplayId: "4821", hostOrderCode: "o-1", placedAt: NOW };

describe("validatePickupCode", () => {
  it("POSTs the code and reads valid: true", async () => {
    const { ctx, calls } = context(() => ({ status: 200, body: '{"valid":true}' }));

    expect(await IFOOD_COURIER.validatePickupCode(ctx, ORDER, { code: "4821" })).toEqual({ kind: "answered", valid: true });
    expect(calls()).toEqual([
      expect.objectContaining({ method: "POST", url: `${API}/validatePickupCode`, body: '{"code":"4821"}' }),
    ]);
    expect(calls()[0]?.headers.Authorization).toBe("Bearer tok-1");
  });

  it("reads valid: false as the marketplace's verdict", async () => {
    const { ctx } = context(() => ({ status: 200, body: '{"valid":false}' }));
    expect(await IFOOD_COURIER.validatePickupCode(ctx, ORDER, { code: "0000" })).toEqual({ kind: "answered", valid: false });
  });

  it("a 2xx with no verdict is our own refusal, never INVALID", async () => {
    const { ctx } = context(() => ({ status: 200, body: "{}" }));
    expect(await IFOOD_COURIER.validatePickupCode(ctx, ORDER, { code: "4821" })).toMatchObject({ kind: "refused", own: true });
  });

  it("a 4xx is a refusal, a 5xx and a timeout a retry, a 401 forgets the token", async () => {
    const refused = context(() => ({ status: 400, body: "MerchantPickupCodeDisabled" }));
    expect(await IFOOD_COURIER.validatePickupCode(refused.ctx, ORDER, { code: "1" })).toEqual({
      kind: "refused",
      status: 400,
      message: "MerchantPickupCodeDisabled",
    });

    const down = context(() => ({ status: 503, body: "busy" }));
    expect(await IFOOD_COURIER.validatePickupCode(down.ctx, ORDER, { code: "1" })).toMatchObject({ kind: "retry" });

    const timeout = context(() => Promise.reject(new Error("timeout after 10000 ms")));
    expect(await IFOOD_COURIER.validatePickupCode(timeout.ctx, ORDER, { code: "1" })).toEqual({
      kind: "retry",
      reason: "timeout after 10000 ms",
    });

    const stale = context(() => ({ status: 401, body: "" }));
    expect(await IFOOD_COURIER.validatePickupCode(stale.ctx, ORDER, { code: "1" })).toMatchObject({ kind: "retry" });
    expect(stale.ctx.tokens.size).toBe(0);
  });
});

describe("the tracking read", () => {
  it("200: the courier's ETA to the store, the delivery's, the position", async () => {
    const body = {
      latitude: -23.55,
      longitude: -46.63,
      expectedDelivery: "2026-11-26T18:40:00.000Z",
      pickupEtaStart: 300,
      deliveryEtaEnd: 2400,
      trackDate: "2026-11-26T17:59:00.000Z",
    };
    const { ctx, calls } = context(() => ({ status: 200, body: JSON.stringify(body) }));

    expect(await IFOOD_COURIER.tracking(ctx, ORDER)).toEqual({
      kind: "tracking",
      tracking: {
        pickupEtaAt: new Date("2026-11-26T18:04:00.000Z"),
        deliveryEtaAt: new Date("2026-11-26T18:40:00.000Z"),
        latitude: -23.55,
        longitude: -46.63,
        trackedAt: new Date("2026-11-26T17:59:00.000Z"),
      },
    });
    expect(calls()).toEqual([expect.objectContaining({ method: "GET", url: `${API}/tracking` })]);
  });

  it("200 with little in it: unstated fields are null, and seconds count from now", async () => {
    const { ctx } = context(() => ({ status: 200, body: JSON.stringify({ pickupEta: 60 }) }));
    expect(await IFOOD_COURIER.tracking(ctx, ORDER)).toEqual({
      kind: "tracking",
      tracking: { pickupEtaAt: new Date("2026-11-26T18:01:00.000Z"), deliveryEtaAt: null, latitude: null, longitude: null, trackedAt: null },
    });
  });

  it("404 before ASSIGN_DRIVER is not yet", async () => {
    const { ctx } = context(() => ({ status: 404, body: "" }));
    expect(await IFOOD_COURIER.tracking(ctx, ORDER)).toEqual({ kind: "notYet" });
  });

  it("a 429 is a retry, a 403 a refusal", async () => {
    expect(await IFOOD_COURIER.tracking(context(() => ({ status: 429, body: "" })).ctx, ORDER)).toMatchObject({ kind: "retry" });
    expect(await IFOOD_COURIER.tracking(context(() => ({ status: 403, body: "no" })).ctx, ORDER)).toMatchObject({
      kind: "refused",
      status: 403,
    });
  });
});
