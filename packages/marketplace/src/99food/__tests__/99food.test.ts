import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AdapterCallContext, MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { createNinetyNineFoodAdapter, NINETY_NINE_FOOD_PROVIDER } from "..";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../en-US";
import { NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR } from "../pt-BR";
import { normalizeOpenDeliveryEvent, normalizeOpenDeliveryOrder, verifyOpenDeliverySignature } from "../normalize";
import { API_BASE, PORTAL, SPEC_ORDER_ID, specDeliveryAddress, specEvent, specOrder } from "./fixtures";

/**
 * The 99Food adapter on Open Delivery v1.7.1, read against the spec's own
 * examples. The engine-level journey (webhook → fetch → aceite → confirm →
 * cancel) is `./engine.test.ts`.
 */

/** A copy of `source` with one key left out. */
function without<T extends object>(source: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...source };
  delete copy[key];
  return copy;
}

const normalizeOrder = (order: unknown) =>
  normalizeOpenDeliveryOrder(order, { missingStreetNumber: NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR.missingStreetNumber });

const adapter = () =>
  createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE, portalUrl: PORTAL });

describe("verifyOpenDeliverySignature (X-App-Signature: lowercase hex HMAC-SHA256 keyed by the client secret)", () => {
  const body = JSON.stringify(specEvent("CREATED"));
  const signed = createHmac("sha256", "client-secret").update(body, "utf8").digest("hex");

  it("accepts the body signed with the client secret, and refuses it altered or unsigned", () => {
    expect(verifyOpenDeliverySignature(body, signed, "client-secret")).toBe(true);
    expect(verifyOpenDeliverySignature(`${body} `, signed, "client-secret")).toBe(false);
    expect(verifyOpenDeliverySignature(body, null, "client-secret")).toBe(false);
    expect(verifyOpenDeliverySignature(body, signed, "another-secret")).toBe(false);
  });

  it("accepts an unsigned delivery only while no secret is configured", () => {
    expect(verifyOpenDeliverySignature(body, null, null)).toBe(true);
  });

  it("is read from the X-App-Signature header", () => {
    const headers: Record<string, string> = { "x-app-signature": signed };
    expect(adapter().readSignature((name) => headers[name] ?? null)).toBe(signed);
  });
});

describe("normalizeOpenDeliveryEvent", () => {
  it("[P1] turns CREATED into an order to fetch: the event carries no body", () => {
    expect(normalizeOpenDeliveryEvent(specEvent("CREATED"))).toEqual({
      provider: NINETY_NINE_FOOD_PROVIDER,
      eventId: `evt-${SPEC_ORDER_ID}-CREATED`,
      eventType: "CREATED",
      externalMerchantId: null,
      externalOrderId: SPEC_ORDER_ID,
      order: null,
      orderToFetch: true,
      cancelled: false,
      cancellationOutcome: null,
    });
  });

  it("reads CANCELLED as a confirmed cancellation and CANCELLATION_REQUEST_DENIED as the request refused", () => {
    expect(normalizeOpenDeliveryEvent(specEvent("CANCELLED"))).toMatchObject({
      cancelled: true,
      cancellationOutcome: "CONFIRMED",
      orderToFetch: false,
    });
    expect(normalizeOpenDeliveryEvent(specEvent("CANCELLATION_REQUEST_DENIED"))).toMatchObject({
      cancelled: false,
      cancellationOutcome: "FAILED",
    });
  });

  it("acts on nothing for the rest of the stream: CONFIRMED, CANCELLATION_REQUESTED, the consumer's handshake", () => {
    for (const type of ["CONFIRMED", "CANCELLATION_REQUESTED", "ORDER_CANCELLATION_REQUEST", "DISPATCHED", "CONCLUDED"]) {
      expect(normalizeOpenDeliveryEvent(specEvent(type))).toMatchObject({
        eventType: type,
        order: null,
        orderToFetch: false,
        cancelled: false,
        cancellationOutcome: null,
      });
    }
  });

  it("refuses only an event with no order id, and derives a stable event id when it has none", () => {
    expect(normalizeOpenDeliveryEvent({ eventType: "CREATED" })).toBeNull();
    expect(normalizeOpenDeliveryEvent(without(specEvent("CREATED"), "eventId"))?.eventId).toBe(`${SPEC_ORDER_ID}:CREATED`);
  });
});

describe("normalizeOpenDeliveryOrder (the GET /v1/orders/{orderId} answer)", () => {
  it("[P1] normalizes the spec's order example: gross total, no commission, the options on the ticket", () => {
    const order = normalizeOrder(specOrder());

    expect(order).toEqual({
      provider: NINETY_NINE_FOOD_PROVIDER,
      externalOrderId: SPEC_ORDER_ID,
      externalDisplayId: "12345",
      buyer: { externalId: "d9730653-a8ba-4e85-8dbb-b5697e6ae8d5", name: "John", phone: "11999999999" },
      lines: [
        {
          externalSku: "22",
          name: "Medium - 2 flavors",
          quantity: 1,
          // The item's totalPrice: the figure itemsPrice (50) is built from.
          unitPriceCents: 5000,
          note: "1/2 Pepperoni, 1/2 Mozzarella · Do not put onions.",
        },
      ],
      // total.orderAmount, as stated — never re-derived from the lines.
      totalCents: 3550,
      // Open Delivery's Order states no commission: "did not say", not 0.
      commissionCents: null,
      deliveryDueAt: new Date("2021-05-27T20:45:10.332Z"),
      placedAt: new Date("2021-05-27T19:38:10.332Z"),
      orderType: "DELIVERY",
      deliveredBy: "MERCHANT",
      deliveryAddress: {
        street: "Gomes de Carvalho Street",
        number: "100",
        neighborhood: "Moema",
        complement: "102",
        reference: null,
        postalCode: "20111000",
        city: "São Paulo",
        state: "SP",
      },
    });
  });

  it("reads the address schema's own keys, the ISO state without its country", () => {
    const order = normalizeOrder({ ...specOrder(), delivery: { deliveredBy: "MARKETPLACE", deliveryAddress: specDeliveryAddress } });
    expect(order?.deliveredBy).toBe("MARKETPLACE");
    expect(order?.deliveryAddress).toEqual({
      street: "Plaza Avenue",
      number: "100",
      neighborhood: "Moema",
      complement: "BL 02 AP 31",
      reference: "Yellow House",
      postalCode: "20111000",
      city: "São Paulo",
      state: "SP",
    });
  });

  it("keeps the door of an address with no number, in the host's words for it", () => {
    const order = normalizeOrder({ ...specOrder(), delivery: { deliveryAddress: without(specDeliveryAddress, "number") } });
    expect(order?.deliveryAddress?.number).toBe("s/n");
  });

  it("keeps a line whose externalCode is missing, keyed on the item id: an unmapped line, never a dropped one", () => {
    const [item] = specOrder().items;
    expect(normalizeOrder({ ...specOrder(), items: [without(item!, "externalCode")] })?.lines[0]?.externalSku).toBe(item!.id);
  });

  it("prices a whole quantity per unit and a fraction as one line at its total, the weight in the note", () => {
    const order = normalizeOrder({
      ...specOrder(),
      items: [
        { id: "a", name: "Soda", externalCode: "S", unit: "UN", quantity: 3, unitPrice: { value: 5 }, totalPrice: { value: 15 } },
        { id: "b", name: "Cheese", externalCode: "C", unit: "KG", quantity: 0.5, unitPrice: { value: 40 }, totalPrice: { value: 20 } },
      ],
    });
    expect(order?.lines).toEqual([
      { externalSku: "S", name: "Soda", quantity: 3, unitPriceCents: 500, note: null },
      { externalSku: "C", name: "Cheese", quantity: 1, unitPriceCents: 2000, note: "0.5 KG" },
    ]);
  });

  it("reads a take-out with no address, and INDOOR as no order type", () => {
    const takeout = normalizeOrder({
      ...specOrder(),
      type: "TAKEOUT",
      delivery: undefined,
      takeout: { mode: "DEFAULT", takeoutDateTime: "2021-05-27T20:00:00.000Z" },
    });
    expect(takeout).toMatchObject({ orderType: "TAKEOUT", deliveredBy: null, deliveryAddress: null });
    expect(takeout?.deliveryDueAt).toEqual(new Date("2021-05-27T20:00:00.000Z"));
    expect(normalizeOrder({ ...specOrder(), type: "INDOOR" })?.orderType).toBeNull();
  });

  it("falls back to the line sum only when no total is stated, and refuses an order with no line or no id", () => {
    expect(normalizeOrder({ ...specOrder(), total: undefined })?.totalCents).toBe(5000);
    expect(normalizeOrder({ ...specOrder(), items: "not a list" })).toBeNull();
    expect(normalizeOrder({ ...specOrder(), id: undefined })).toBeNull();
  });
});

/** A context answering each request through `answer`, recording them. */
function context(answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse) {
  const requests: MarketplaceHttpRequest[] = [];
  const ctx: AdapterCallContext = {
    http: async (request) => {
      requests.push(request);
      return answer(request);
    },
    credentials: { clientId: "app-id", clientSecret: "app-secret", webhookSecret: null },
    environment: "SANDBOX",
    tokens: new Map(),
    now: new Date("2026-11-13T12:00:00.000Z"),
  };
  return { ctx, requests };
}

const TOKEN = { status: 200, body: JSON.stringify({ access_token: "tok", token_type: "bearer", expires_in: 3600 }) };
const ref = { externalOrderId: SPEC_ORDER_ID, externalDisplayId: "12345", hostOrderCode: "order-1", placedAt: new Date() };

describe("the 99Food adapter", () => {
  it("[P1] states its capabilities and serves Open Delivery's eleven merchant reasons, offline", () => {
    const subject = adapter();
    expect(subject.provider).toBe("NINETY_NINE_FOOD");
    expect(subject.capabilities).toEqual({
      apiConfirm: true,
      apiCancel: true,
      cancelAfterAccept: true,
      asyncCancellationOutcome: true,
      perOrderAppLink: false,
      confirmTakesPreparationTime: true,
      cancellationAnswerWindowMs: 300_000,
    });
    expect(subject.cancellationReasons()).toHaveLength(11);
    expect(subject.cancellationReasons().filter((reason) => reason.itemUnavailable).map((r) => r.code)).toEqual([
      "UNAVAILABLE_ITEM",
    ]);
    expect(subject.appLink({ externalOrderId: SPEC_ORDER_ID, externalDisplayId: null })).toBe(PORTAL);
  });

  it("labels every reason in both packs", () => {
    for (const pack of [NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR, NINETY_NINE_FOOD_ADAPTER_COPY_EN_US]) {
      const subject = createNinetyNineFoodAdapter({ copy: pack, apiBaseUrl: API_BASE, portalUrl: PORTAL });
      for (const reason of subject.cancellationReasons()) expect(reason.label.trim()).not.toBe("");
    }
  });

  it("refuses a base URL or portal that is not https, at construction", () => {
    expect(() =>
      createNinetyNineFoodAdapter({
        copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US,
        apiBaseUrl: { ...API_BASE, PRODUCTION: "http://od.example.test" },
        portalUrl: PORTAL,
      }),
    ).toThrow(/PRODUCTION must be https/);
    expect(() =>
      createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE, portalUrl: "nope" }),
    ).toThrow(/portalUrl is not a URL/);
  });

  it("fetches an order with a client_credentials token, form-encoded, and keeps the token for the next call", async () => {
    const { ctx, requests } = context((request) =>
      request.url.endsWith("/oauth/token") ? TOKEN : { status: 200, body: JSON.stringify(specOrder()) },
    );
    const first = await adapter().fetchOrder!(ctx, { externalOrderId: SPEC_ORDER_ID });
    await adapter().fetchOrder!(ctx, { externalOrderId: SPEC_ORDER_ID });

    expect(first).toMatchObject({ kind: "order", order: { externalOrderId: SPEC_ORDER_ID, totalCents: 3550 } });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://sandbox.od.example.test/oauth/token",
      `GET https://sandbox.od.example.test/v1/orders/${SPEC_ORDER_ID}`,
      `GET https://sandbox.od.example.test/v1/orders/${SPEC_ORDER_ID}`,
    ]);
    expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toEqual({
      client_id: "app-id",
      client_secret: "app-secret",
      grant_type: "client_credentials",
    });
    expect(requests[1]?.headers.Authorization).toBe("Bearer tok");
  });

  it("answers a fetch: 404 (an expired order) refused, 503 retried, a 401 forgets the token, a throw retried", async () => {
    const answers = [404, 503, 401];
    for (const status of answers) {
      const { ctx } = context((request) => (request.url.endsWith("/oauth/token") ? TOKEN : { status, body: "x" }));
      const result = await adapter().fetchOrder!(ctx, { externalOrderId: SPEC_ORDER_ID });
      expect(result.kind).toBe(status === 404 ? "refused" : "retry");
      if (status === 401) expect(ctx.tokens.size).toBe(0);
    }
    const thrown = context(() => {
      throw new Error("socket hang up");
    });
    expect(await adapter().fetchOrder!(thrown.ctx, { externalOrderId: SPEC_ORDER_ID })).toEqual({
      kind: "retry",
      reason: "socket hang up",
    });
  });

  it("confirms with the spec's OrderConfirmed body, the preparation time when stated, a 422 as already done", async () => {
    const { ctx, requests } = context((request) => (request.url.endsWith("/oauth/token") ? TOKEN : { status: 202, body: "" }));
    expect(await adapter().confirm(ctx, ref, { preparationMinutes: 25 })).toEqual({ kind: "accepted" });
    expect(requests[1]?.url).toBe(`https://sandbox.od.example.test/v1/orders/${SPEC_ORDER_ID}/confirm`);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
      orderExternalCode: "order-1",
      createdAt: "2026-11-13T12:00:00.000Z",
      preparationTime: 25,
    });

    const duplicate = context((request) => (request.url.endsWith("/oauth/token") ? TOKEN : { status: 422, body: "{}" }));
    expect(await adapter().confirm(duplicate.ctx, ref, { preparationMinutes: null })).toEqual({ kind: "accepted" });
    expect(JSON.parse(duplicate.requests[1]?.body ?? "{}")).not.toHaveProperty("preparationTime");
  });

  it("requests a cancellation with the spec's RequestCancelled body {reason, code, mode}", async () => {
    const { ctx, requests } = context((request) => (request.url.endsWith("/oauth/token") ? TOKEN : { status: 202, body: "" }));
    const [reason] = adapter().cancellationReasons().filter((r) => r.code === "UNAVAILABLE_ITEM");
    const result = await adapter().requestCancellation(ctx, ref, {
      reason: reason!,
      text: "",
      mode: "MANUAL",
      offendingSkus: ["22"],
    });

    expect(result).toEqual({ kind: "accepted" });
    expect(requests[1]?.url).toBe(`https://sandbox.od.example.test/v1/orders/${SPEC_ORDER_ID}/requestCancellation`);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
      reason: "Item unavailable",
      code: "UNAVAILABLE_ITEM",
      mode: "MANUAL",
    });
  });

  it("reads a 422 CancellationError: already CANCELLED is done, CANCELLATION_REQUEST_DENIED is refused", async () => {
    const [reason] = adapter().cancellationReasons();
    const input = { reason: reason!, text: "closing early", mode: "AUTO" as const, offendingSkus: [] };
    for (const [status, kind] of [
      ["CANCELLED", "accepted"],
      ["CANCELLATION_REQUEST_DENIED", "refused"],
    ] as const) {
      const { ctx, requests } = context((request) =>
        request.url.endsWith("/oauth/token")
          ? TOKEN
          : { status: 422, body: JSON.stringify({ title: "x", status: 422, cancellationStatus: status }) },
      );
      expect((await adapter().requestCancellation(ctx, ref, input)).kind).toBe(kind);
      expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({ reason: "closing early", mode: "AUTO" });
    }
  });

  it("uses the PRODUCTION base for a production connection", async () => {
    const { ctx, requests } = context((request) => (request.url.endsWith("/oauth/token") ? TOKEN : { status: 202, body: "" }));
    await adapter().confirm({ ...ctx, environment: "PRODUCTION" }, ref, { preparationMinutes: null });
    expect(requests.every((request) => request.url.startsWith("https://od.example.test/"))).toBe(true);
  });
});
