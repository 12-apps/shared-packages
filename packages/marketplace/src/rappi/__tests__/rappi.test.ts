import { describe, expect, it } from "vitest";

import type { AdapterCallContext, MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { createRappiAdapter, RAPPI_CANCELLATION_ANSWER_WINDOW_MS, RAPPI_PROVIDER, type RappiAdapterConfig } from "..";
import { RAPPI_ADAPTER_COPY_EN_US } from "../en-US";
import { RAPPI_ADAPTER_COPY_PT_BR } from "../pt-BR";
import { normalizeRappiEvent, normalizeRappiOrder, verifyRappiSignature, type RappiAmountUnit } from "../normalize";
import {
  API_BASE,
  PORTAL,
  PORTAL_ORDER_ID,
  PORTAL_STORE_ID,
  portalCancel,
  portalOrder,
  portalOtherEvent,
  portalScheduled,
  portalScheduledCancelled,
  signed,
  TOKEN_URL,
} from "./fixtures";

/**
 * The Rappi adapter, read against the portal's own examples. The engine-level
 * journey (webhook → ingest → aceite → take → reject) is `./engine.test.ts`.
 */

const CONFIG: RappiAdapterConfig = {
  copy: RAPPI_ADAPTER_COPY_EN_US,
  apiBaseUrl: API_BASE,
  tokenUrl: TOKEN_URL,
  portalUrl: PORTAL,
  amountUnit: "MINOR_UNITS",
};
const adapter = (overrides: Partial<RappiAdapterConfig> = {}) => createRappiAdapter({ ...CONFIG, ...overrides });
const options = (amountUnit: RappiAmountUnit = "MINOR_UNITS") => ({ amountUnit, missingStreetNumber: "s/n" });
const ORDERS = `${API_BASE.SANDBOX}/orders`;
const ORDER_REF = { externalOrderId: PORTAL_ORDER_ID, externalDisplayId: PORTAL_ORDER_ID, hostOrderCode: "order-1", placedAt: new Date("2026-11-13T11:58:00.000Z") };

/** A call context over a scripted fake: the token endpoint answers a token, the rest `answer`. */
function context(answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse | Promise<MarketplaceHttpResponse>) {
  const sent: MarketplaceHttpRequest[] = [];
  const ctx: AdapterCallContext = {
    http: async (request) => {
      sent.push(request);
      if (request.url === TOKEN_URL.SANDBOX || request.url === TOKEN_URL.PRODUCTION) {
        return { status: 200, body: JSON.stringify({ access_token: "tok" }) };
      }
      return answer(request);
    },
    credentials: { clientId: "client", clientSecret: "secret", webhookSecret: "hook" },
    environment: "SANDBOX",
    tokens: new Map(),
    now: new Date("2026-11-13T12:00:00.000Z"),
  };
  return { ctx, requests: sent };
}

describe("verifyRappiSignature (Rappi-Signature: t=…,sign=… over `t.body`, HMAC-SHA256)", () => {
  const body = JSON.stringify(portalCancel());

  it("accepts the body signed as the portal describes, and refuses it altered, re-timed or under another secret", () => {
    const header = signed(body, "hook");
    expect(verifyRappiSignature(body, header, "hook")).toBe(true);
    expect(verifyRappiSignature(`${body} `, header, "hook")).toBe(false);
    expect(verifyRappiSignature(body, header.replace("t=1731499200", "t=1731499201"), "hook")).toBe(false);
    expect(verifyRappiSignature(body, header, "another")).toBe(false);
  });

  it("reads the parts in any order, with spaces, and refuses a header missing either", () => {
    const sign = signed(body, "hook").split(",")[1];
    expect(verifyRappiSignature(body, `${sign} , t=1731499200`, "hook")).toBe(true);
    expect(verifyRappiSignature(body, sign ?? "", "hook")).toBe(false);
    expect(verifyRappiSignature(body, "t=1731499200", "hook")).toBe(false);
    expect(verifyRappiSignature(body, "garbage", "hook")).toBe(false);
  });

  it("refuses every delivery while no secret is configured: the secret is required", () => {
    expect(verifyRappiSignature(body, signed(body, "hook"), null)).toBe(false);
    expect(verifyRappiSignature(body, null, null)).toBe(false);
    expect(verifyRappiSignature(body, null, "hook")).toBe(false);
  });

  it("is read from the Rappi-Signature header", () => {
    const headers: Record<string, string> = { "rappi-signature": "t=1,sign=ab" };
    expect(adapter().readSignature((name) => headers[name] ?? null)).toBe("t=1,sign=ab");
  });

  it("parses a header of many separators by splitting, with no regex to backtrack on", () => {
    const hostile = `${",".repeat(50_000)}t=${"=".repeat(50_000)}`;
    expect(verifyRappiSignature(body, hostile, "hook")).toBe(false);
  });
});

describe("normalizeRappiEvent", () => {
  it("[P1] reads a NEW_ORDER (the getOrders element) as an order, named by Rappi's store id", () => {
    const event = normalizeRappiEvent(portalOrder(), options());
    expect(event).toMatchObject({
      provider: RAPPI_PROVIDER,
      eventId: `${PORTAL_ORDER_ID}:NEW_ORDER`,
      eventType: "NEW_ORDER",
      externalMerchantId: PORTAL_STORE_ID,
      externalOrderId: PORTAL_ORDER_ID,
      cancelled: false,
      cancellationOutcome: null,
    });
    expect(event?.order?.externalOrderId).toBe(PORTAL_ORDER_ID);
    expect(event?.orderToFetch).toBeUndefined();
  });

  it("reads ORDER_EVENT_CANCEL as the marketplace's cancellation", () => {
    expect(normalizeRappiEvent(portalCancel(), options())).toEqual({
      provider: RAPPI_PROVIDER,
      eventId: "106:ORDER_EVENT_CANCEL:canceled_with_charge",
      eventType: "ORDER_EVENT_CANCEL",
      externalMerchantId: "900109448",
      externalOrderId: "106",
      order: null,
      cancelled: true,
      cancellationOutcome: "CONFIRMED",
    });
  });

  it("records and acts on nothing for ORDER_OTHER_EVENT and the two scheduled notices", () => {
    expect(normalizeRappiEvent(portalOtherEvent(), options())).toMatchObject({
      eventType: "ORDER_OTHER_EVENT",
      eventId: "344949817:ORDER_OTHER_EVENT:taken_visible_order:2023-05-04 12:01:22",
      order: null,
      cancelled: false,
    });
    expect(normalizeRappiEvent(portalScheduled(), options())).toMatchObject({
      eventType: "NEW_ORDER_SCHEDULED",
      externalMerchantId: "900105814",
      order: null,
      cancelled: false,
    });
    expect(normalizeRappiEvent(portalScheduledCancelled(), options())).toMatchObject({
      eventType: "NEW_ORDER_SCHEDULED_CANCELLED",
      externalMerchantId: "900105814",
      order: null,
      cancelled: false,
    });
  });

  it("(ESTIMATED) never reads a cancellation into an event with event_time, or one whose name says no cancel", () => {
    expect(normalizeRappiEvent({ ...portalOtherEvent(), event: "canceled_by_user" }, options())).toMatchObject({ cancelled: false });
    expect(normalizeRappiEvent({ event: "courier_assigned", order_id: "7", store_id: "1" }, options())).toMatchObject({
      eventType: "ORDER_OTHER_EVENT",
      cancelled: false,
    });
    expect(normalizeRappiEvent({ event: "CANCELLED", order_id: "7", store_id: "1" }, options())).toMatchObject({ cancelled: true });
  });

  it("refuses a delivery that names no order (PING, MENU_APPROVED, STORE_CONNECTIVITY)", () => {
    expect(normalizeRappiEvent({ store_id: 999 }, options())).toBeNull();
    expect(normalizeRappiEvent({ store_id: "900109448", message: "Menu Approved" }, options())).toBeNull();
    expect(normalizeRappiEvent({ external_store_id: "999", enabled: false, message: "x" }, options())).toBeNull();
    expect(normalizeRappiEvent({ order_detail: {} }, options())).toBeNull();
  });
});

describe("normalizeRappiOrder (the NEW_ORDER body)", () => {
  it("[P1] normalizes the portal's sample: the restaurant's total, no commission, subitems and comments on the ticket", () => {
    const order = normalizeRappiOrder(portalOrder(), options());
    expect(order).toEqual({
      provider: RAPPI_PROVIDER,
      externalOrderId: PORTAL_ORDER_ID,
      externalDisplayId: PORTAL_ORDER_ID,
      externalMerchantId: PORTAL_STORE_ID,
      buyer: { externalId: null, name: "John Doe", phone: "3163535" },
      lines: [
        { externalSku: "1234", name: "Chicken and Apple Salad", quantity: 3, unitPriceCents: 42400, note: "Burrata Cheese · No vinegar" },
        {
          // No `sku`: keyed on Rappi's item id, an unmapped line rather than a dropped one.
          externalSku: "2089918082",
          name: "Seafood Salad",
          quantity: 2,
          unitPriceCents: 38400,
          note: "With white vinaigrette, Ricotta Cheese",
        },
      ],
      totalCents: 204180,
      commissionCents: null,
      deliveryDueAt: null,
      placedAt: new Date("2019-04-10T11:12:57.000Z"),
      orderType: "DELIVERY",
      deliveredBy: "MARKETPLACE",
      deliveryAddress: {
        street: "Nombre de la calle",
        number: "5050",
        neighborhood: "Barrio",
        complement: "Portón verde",
        reference: null,
        postalCode: "12345",
        city: "Ciudad de México",
        state: null,
      },
    });
  });

  it("(ESTIMATED) reads whole-currency amounts as ×100 when the host says MAJOR_UNITS", () => {
    const order = normalizeRappiOrder(portalOrder(), options("MAJOR_UNITS"));
    expect(order?.totalCents).toBe(20_418_000);
    expect(order?.lines[0]?.unitPriceCents).toBe(4_240_000);
  });

  it("[B2] keeps every item's lines summing EXACTLY to its total, a fraction included", () => {
    const base = portalOrder();
    const items = [
      { sku: "A", name: "A", price: 333, quantity: 3, subitems: [{ name: "x", price: 1, quantity: 2 }] },
      { sku: "B", name: "B", price: 999, quantity: 0.5 },
    ];
    const order = normalizeRappiOrder({ ...base, order_detail: { ...base.order_detail, items } }, options());
    const sumOf = (sku: string) =>
      (order?.lines ?? []).filter((line) => line.externalSku === sku).reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
    expect(sumOf("A")).toBe(3 * (333 + 2));
    expect(sumOf("B")).toBe(500);
  });

  it("reads the store's own courier (marketplace), a pickup with no address, a Brazilian state and no number", () => {
    const base = portalOrder();
    const own = normalizeRappiOrder({ ...base, order_detail: { ...base.order_detail, delivery_method: "marketplace" } }, options());
    expect(own).toMatchObject({ orderType: "DELIVERY", deliveredBy: "MERCHANT" });
    const pickup = normalizeRappiOrder({ ...base, order_detail: { ...base.order_detail, delivery_method: "pickup" } }, options());
    expect(pickup).toMatchObject({ orderType: "TAKEOUT", deliveredBy: null, deliveryAddress: null });
    const br = normalizeRappiOrder(
      {
        ...base,
        order_detail: {
          ...base.order_detail,
          delivery_information: { street_name: "Rua A", neighborhood: "Centro", postal_code: "01310-100", federal_unit: "SP", city: "São Paulo" },
        },
      },
      options(),
    );
    expect(br?.deliveryAddress).toMatchObject({ street: "Rua A", number: "s/n", postalCode: "01310100", state: "SP" });
  });

  it("falls back to the line sum only when no total is stated, and refuses an order with no line or no id", () => {
    const base = portalOrder();
    const noTotal = normalizeRappiOrder({ ...base, order_detail: { ...base.order_detail, totals: {} } }, options());
    expect(noTotal?.totalCents).toBe(42400 * 3 + 38400 * 2);
    expect(normalizeRappiOrder({ ...base, order_detail: { ...base.order_detail, items: [] } }, options())).toBeNull();
    expect(normalizeRappiOrder({ ...base, order_detail: { ...base.order_detail, order_id: "" } }, options())).toBeNull();
  });
});

describe("the Rappi adapter", () => {
  it("[P1] states what Rappi can do: reject only before take, the answer is the outcome, the portal link", () => {
    const rappi = adapter();
    expect(rappi.provider).toBe("RAPPI");
    expect(rappi.capabilities).toEqual({
      apiConfirm: true,
      apiCancel: true,
      cancelAfterAccept: false,
      asyncCancellationOutcome: false,
      perOrderAppLink: false,
      confirmTakesPreparationTime: true,
      cancellationAnswerWindowMs: RAPPI_CANCELLATION_ANSWER_WINDOW_MS,
    });
    expect(rappi.appLink({ externalOrderId: "1", externalDisplayId: null })).toBe(PORTAL);
  });

  it("serves the portal's six reject types, the three item ones needing items, offline", () => {
    expect(adapter().cancellationReasons()).toEqual([
      { code: "ITEM_OUT_OF_STOCK", label: "Item unavailable", itemUnavailable: true, needsItems: true },
      { code: "ITEM_NOT_FOUND", label: "Item not found", itemUnavailable: false, needsItems: true },
      { code: "ITEM_WRONG_PRICE", label: "Wrong item price", itemUnavailable: false, needsItems: true },
      { code: "ORDER_MISSING_INFORMATION", label: "Order information missing", itemUnavailable: false, needsItems: false },
      { code: "ORDER_MISSING_ADDRESS_INFORMATION", label: "Address information missing", itemUnavailable: false, needsItems: false },
      { code: "ORDER_TOTAL_INCORRECT", label: "Order total incorrect", itemUnavailable: false, needsItems: false },
    ]);
    for (const pack of [RAPPI_ADAPTER_COPY_PT_BR, RAPPI_ADAPTER_COPY_EN_US]) {
      expect(Object.values(pack.reasonLabels).every((label) => label.trim() !== "")).toBe(true);
    }
  });

  it("refuses at construction a base URL or portal that is not https, and an amount unit it does not know", () => {
    expect(() => adapter({ apiBaseUrl: { ...API_BASE, PRODUCTION: "http://x.test" } })).toThrow(/apiBaseUrl.PRODUCTION must be https/);
    expect(() => adapter({ tokenUrl: { ...TOKEN_URL, SANDBOX: "nope" } })).toThrow(/tokenUrl.SANDBOX is not a URL/);
    expect(() => adapter({ portalUrl: "http://p.test" })).toThrow(/portalUrl must be https/);
    expect(() => adapter({ amountUnit: "CENTS" as RappiAmountUnit })).toThrow(/amountUnit/);
  });

  it("takes with the cooking time, after one JSON client-credentials token sent as x-authorization", async () => {
    const { ctx, requests } = context(() => ({ status: 200, body: "{}" }));
    const rappi = adapter();

    expect(await rappi.confirm(ctx, ORDER_REF, { preparationMinutes: 20 })).toEqual({ kind: "accepted" });
    expect(await rappi.confirm(ctx, ORDER_REF, { preparationMinutes: null })).toEqual({ kind: "accepted" });

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${TOKEN_URL.SANDBOX}`,
      `PUT ${ORDERS}/${PORTAL_ORDER_ID}/take/20`,
      // No cooking time: the order keeps its own.
      `PUT ${ORDERS}/${PORTAL_ORDER_ID}/take/`,
    ]);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ client_id: "client", client_secret: "secret" });
    expect(requests[1]?.headers).toEqual({ "x-authorization": "Bearer tok" });
    expect(requests[1]?.body).toBeUndefined();
  });

  it("rejects with { reason, cancel_type, items_skus }: the store's text, else the label; SKUs only when named", async () => {
    const { ctx, requests } = context(() => ({ status: 200, body: "{}" }));
    const rappi = adapter();
    const [outOfStock, , , missing] = rappi.cancellationReasons();

    await rappi.requestCancellation(ctx, ORDER_REF, { reason: outOfStock!, text: "", mode: "MANUAL", offendingSkus: ["1234"] });
    await rappi.requestCancellation(ctx, ORDER_REF, { reason: missing!, text: "Sem número", mode: "MANUAL", offendingSkus: [] });

    const rejects = requests.filter((r) => r.url.endsWith("/reject"));
    expect(rejects.map((r) => `${r.method} ${r.url}`)).toEqual([
      `PUT ${ORDERS}/${PORTAL_ORDER_ID}/reject`,
      `PUT ${ORDERS}/${PORTAL_ORDER_ID}/reject`,
    ]);
    expect(rejects.map((r) => JSON.parse(r.body ?? "{}"))).toEqual([
      { reason: "Item unavailable", cancel_type: "ITEM_OUT_OF_STOCK", items_skus: ["1234"] },
      { reason: "Sem número", cancel_type: "ORDER_MISSING_INFORMATION" },
    ]);
    expect(rejects[0]?.headers["Content-Type"]).toBe("application/json");
  });

  it("[B3] reads every refused answer as a refusal, whatever its body says; 5xx and 429 retried; a 401 forgets the token", async () => {
    const rappi = adapter();
    const [reason] = rappi.cancellationReasons();
    const input = { reason: reason!, text: "", mode: "MANUAL" as const, offendingSkus: ["1234"] };
    for (const [status, kind] of [
      [400, "refused"],
      [404, "refused"],
      [409, "refused"],
      [429, "retry"],
      [503, "retry"],
    ] as const) {
      const { ctx } = context(() => ({ status, body: "Order successfully rejected" }));
      expect((await rappi.requestCancellation(ctx, ORDER_REF, input)).kind).toBe(kind);
      expect((await rappi.confirm(ctx, ORDER_REF, { preparationMinutes: null })).kind).toBe(kind);
    }
    const { ctx } = context(() => ({ status: 401, body: "" }));
    expect(await rappi.confirm(ctx, ORDER_REF, { preparationMinutes: null })).toEqual({ kind: "retry", reason: "Rappi refused the token" });
    expect(ctx.tokens.size).toBe(0);
  });

  it("retries a call that got no answer, and a token answer without a token; refuses a refused token request", async () => {
    const rappi = adapter();
    const thrown = context(() => {
      throw new Error("socket hang up");
    });
    expect(await rappi.confirm(thrown.ctx, ORDER_REF, { preparationMinutes: null })).toEqual({ kind: "retry", reason: "socket hang up" });

    const noToken: AdapterCallContext = { ...thrown.ctx, tokens: new Map(), http: async () => ({ status: 200, body: "{}" }) };
    expect(await rappi.confirm(noToken, ORDER_REF, { preparationMinutes: null })).toMatchObject({ kind: "retry" });
    const refused: AdapterCallContext = { ...thrown.ctx, tokens: new Map(), http: async () => ({ status: 403, body: "bad client" }) };
    expect(await rappi.confirm(refused, ORDER_REF, { preparationMinutes: null })).toMatchObject({ kind: "refused", status: 403 });
  });

  it("keeps the token a week when the answer states no expiry, and renews it after", async () => {
    const { ctx, requests } = context(() => ({ status: 200, body: "{}" }));
    const rappi = adapter();
    await rappi.confirm(ctx, ORDER_REF, { preparationMinutes: null });
    const sixDays = { ...ctx, now: new Date(ctx.now.getTime() + 6 * 24 * 3_600_000) };
    await rappi.confirm(sixDays, ORDER_REF, { preparationMinutes: null });
    const eightDays = { ...ctx, now: new Date(ctx.now.getTime() + 8 * 24 * 3_600_000) };
    await rappi.confirm(eightDays, ORDER_REF, { preparationMinutes: null });
    expect(requests.filter((r) => r.url === TOKEN_URL.SANDBOX)).toHaveLength(2);
  });

  it("uses the PRODUCTION hosts for a production connection, trailing slashes cut", async () => {
    const { ctx, requests } = context(() => ({ status: 200, body: "{}" }));
    const rappi = adapter({ apiBaseUrl: { ...API_BASE, PRODUCTION: `${API_BASE.PRODUCTION}///` } });
    await rappi.confirm({ ...ctx, environment: "PRODUCTION" }, ORDER_REF, { preparationMinutes: 15 });
    expect(requests.map((r) => r.url)).toEqual([
      TOKEN_URL.PRODUCTION,
      `${API_BASE.PRODUCTION}/orders/${PORTAL_ORDER_ID}/take/15`,
    ]);
  });
});
