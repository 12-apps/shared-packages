import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AdapterCallContext, MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import type { CatalogueCallContext } from "../../core/catalogue-port";
import {
  canonicalJson,
  createKeetaAdapter,
  createKeetaAuthorization,
  KEETA_API_BASE_URL,
  KEETA_PORTAL_URL,
  KEETA_PROVIDER,
  normalizeKeetaAuthorizationEvent,
  normalizeKeetaEvent,
  verifyKeetaSignature,
} from "..";
import { KEETA_ADAPTER_COPY_EN_US } from "../en-US";
import { KEETA_ADAPTER_COPY_PT_BR } from "../pt-BR";
import { keetaSignatureString } from "../signature";
import {
  API_BASE,
  KEETA_AUTHORIZATION_WEBHOOK,
  KEETA_MERCHANT_ID,
  KEETA_MERCHANT_INFO,
  KEETA_ORDER_ID,
  KEETA_SIGNATURE_EXAMPLES,
  keetaEvent,
} from "./fixtures";

/**
 * The Keeta adapter against Keeta's own documentation: the signature, the
 * token, the requests each call builds, the self-serve authorization and the
 * menu / pause calls. The engine-level journey is `./engine.test.ts`.
 */

const SECRET = "app-secret";
const TOKEN = { status: 200, body: JSON.stringify({ access_token: "tok", token_type: "bearer", expires_in: 7200 }) };
const NOW = new Date("2026-11-26T12:00:00Z");

function context(answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse = () => ({ status: 204, body: "" })) {
  const requests: MarketplaceHttpRequest[] = [];
  const ctx: CatalogueCallContext = {
    http: (request) => {
      requests.push(request);
      return Promise.resolve(request.url.endsWith("/oauth/token") ? TOKEN : answer(request));
    },
    credentials: { clientId: "app-id", clientSecret: SECRET, webhookSecret: SECRET },
    environment: "SANDBOX",
    tokens: new Map(),
    now: NOW,
    externalMerchantId: KEETA_MERCHANT_ID,
    loadImage: () => Promise.resolve(null),
    category: () => Promise.resolve({ id: "unused" }),
    forgetCategory: () => Promise.resolve(),
  };
  return { ctx, requests };
}

/** The signature Keeta's reference implementation computes, recomputed from the request as sent. */
function expectSigned(request: MarketplaceHttpRequest | undefined): void {
  if (!request) throw new Error("no request");
  const expected = createHmac("sha256", SECRET).update(keetaSignatureString(request.url, request.body), "utf8").digest("base64");
  expect(request.headers["X-App-Signature"]).toBe(expected);
}

const adapter = (extra: Partial<Parameters<typeof createKeetaAdapter>[0]> = {}) =>
  createKeetaAdapter({ copy: KEETA_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE, ...extra });

const order = { externalOrderId: KEETA_ORDER_ID, externalDisplayId: "4821", hostOrderCode: "host-1", placedAt: NOW };

describe("the request signature (Base64 HMAC-SHA256 of URL + sorted query + RFC 8785 body)", () => {
  it("builds exactly the strings of Keeta's own examples", () => {
    for (const example of KEETA_SIGNATURE_EXAMPLES) {
      const body = example.body === undefined ? undefined : canonicalJson(example.body);
      expect(keetaSignatureString(example.url, body)).toBe(example.signed);
    }
  });

  it("leaves out an empty body, `{}`, and its `&`", () => {
    expect(keetaSignatureString("https://k.test/v1/x", "")).toBe("https://k.test/v1/x");
    expect(keetaSignatureString("https://k.test/v1/x", "{}")).toBe("https://k.test/v1/x");
  });

  it("canonicalizes by RFC 8785: keys sorted at every depth, no whitespace, undefined dropped", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, "x", null], c: true }, z: undefined })).toBe('{"a":{"c":true,"d":[1,"x",null]},"b":1}');
  });

  it("verifies a webhook signed Base64 over the raw body, and refuses it altered, hex-encoded or with no secret", () => {
    const body = JSON.stringify(keetaEvent("CREATED"));
    const signed = createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
    const hex = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
    expect(verifyKeetaSignature(body, signed, SECRET)).toBe(true);
    expect(verifyKeetaSignature(`${body} `, signed, SECRET)).toBe(false);
    expect(verifyKeetaSignature(body, hex, SECRET)).toBe(false);
    expect(verifyKeetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyKeetaSignature(body, signed, null)).toBe(false);
    expect(adapter().readSignature((name) => (name === "x-app-signature" ? signed : null))).toBe(signed);
  });
});

describe("the token (POST /oauth/token, JSON app_level_token, signed)", () => {
  it("asks once for the application and reuses the token, every call signed", async () => {
    const { ctx, requests } = context(() => ({ status: 202, body: "" }));
    const subject = adapter();
    await subject.confirm(ctx, order, { preparationMinutes: 20 });
    await subject.confirm(ctx, order, { preparationMinutes: null });

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${API_BASE.SANDBOX}/oauth/token`,
      `POST ${API_BASE.SANDBOX}/v1/orders/${KEETA_ORDER_ID}/confirm`,
      `POST ${API_BASE.SANDBOX}/v1/orders/${KEETA_ORDER_ID}/confirm`,
    ]);
    expect(requests[0]?.headers["Content-Type"]).toBe("application/json");
    expect(requests[0]?.body).toBe('{"client_id":"app-id","client_secret":"app-secret","grant_type":"app_level_token"}');
    for (const request of requests) expectSigned(request);
    expect(requests[1]?.headers.Authorization).toBe("Bearer tok");
    expect(requests[1]?.body).toBe(`{"createdAt":"${NOW.toISOString()}","orderExternalCode":"host-1","preparationTime":20}`);
  });

  it("a refused grant is our credentials (own); a 401 on a call forgets the token and retries", async () => {
    const refused = context();
    refused.ctx.http = () => Promise.resolve({ status: 401, body: "invalid" });
    expect(await adapter().confirm(refused.ctx, order, { preparationMinutes: null })).toMatchObject({ kind: "refused", own: true });

    const stale = context(() => ({ status: 401, body: "expired" }));
    expect(await adapter().confirm(stale.ctx, order, { preparationMinutes: null })).toEqual({
      kind: "retry",
      reason: "Keeta refused the token",
    });
    expect(stale.ctx.tokens.size).toBe(0);
  });
});

describe("the order calls", () => {
  it("requests a cancellation with the PDV codes as outOfStockItems for an unavailable item", async () => {
    const { ctx, requests } = context(() => ({ status: 202, body: "" }));
    const [item] = adapter().cancellationReasons().filter((reason) => reason.itemUnavailable);
    const result = await adapter().requestCancellation(ctx, order, {
      reason: item!,
      text: "",
      mode: "MANUAL",
      offendingSkus: ["PDV-1002"],
    });

    expect(result).toEqual({ kind: "accepted" });
    expect(requests.at(-1)?.url).toBe(`${API_BASE.SANDBOX}/v1/orders/${KEETA_ORDER_ID}/requestCancellation`);
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({
      reason: "Item unavailable",
      code: "UNAVAILABLE_ITEM",
      mode: "MANUAL",
      outOfStockItems: ["PDV-1002"],
    });
    expectSigned(requests.at(-1));
  });

  it("sends no outOfStockItems with another reason, and reads a 422 CANCELLED as done", async () => {
    const { ctx, requests } = context(() => ({ status: 422, body: JSON.stringify({ title: "x", status: 422, cancellationStatus: "CANCELLED" }) }));
    const reason = adapter().cancellationReasons().find((r) => r.code === "OUTSIDE_DELIVERY_HOURS")!;
    expect(await adapter().requestCancellation(ctx, order, { reason, text: "closing", mode: "AUTO", offendingSkus: ["PDV-1"] })).toEqual({
      kind: "accepted",
    });
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({ reason: "closing", code: "OUTSIDE_DELIVERY_HOURS", mode: "AUTO" });
  });

  it("takes READY for every order, DISPATCHED and HANDED_OVER only for the merchant's bag, nothing for a take-out", async () => {
    const subject = adapter();
    expect(subject.capabilities.statusSteps).toEqual(["READY", "DISPATCHED", "HANDED_OVER"]);
    expect(subject.statusSupported?.({ step: "READY", deliveredBy: "MARKETPLACE" })).toBe(true);
    expect(subject.statusSupported?.({ step: "DISPATCHED", deliveredBy: "MARKETPLACE" })).toBe(false);
    expect(subject.statusSupported?.({ step: "HANDED_OVER", deliveredBy: null })).toBe(false);

    const { ctx, requests } = context(() => ({ status: 202, body: "" }));
    expect(await subject.informStatus?.(ctx, order, { step: "HANDED_OVER", deliveredBy: "MERCHANT" })).toEqual({ kind: "accepted" });
    expect(await subject.informStatus?.(ctx, order, { step: "HANDED_OVER", deliveredBy: null })).toEqual({ kind: "unsupported" });
    expect(requests.map((r) => r.url).filter((url) => !url.endsWith("/oauth/token"))).toEqual([
      `${API_BASE.SANDBOX}/v1/orders/${KEETA_ORDER_ID}/delivered`,
    ]);
  });
});

describe("the event reader", () => {
  it("CREATED is an order to fetch, CANCELLED a cancellation, the lifecycle events lifecycle, the rest nothing", () => {
    expect(normalizeKeetaEvent(keetaEvent("CREATED"))).toMatchObject({ provider: KEETA_PROVIDER, orderToFetch: true, cancelled: false });
    expect(normalizeKeetaEvent(keetaEvent("CANCELLED"))).toMatchObject({ cancelled: true, cancellationOutcome: "CONFIRMED" });
    expect(normalizeKeetaEvent(keetaEvent("DISPATCHED"))).toMatchObject({ lifecycle: "DISPATCHED" });
    expect(normalizeKeetaEvent(keetaEvent("RIDER_ARRIVED_AT_STORE"))).toMatchObject({
      orderToFetch: false,
      cancelled: false,
      cancellationOutcome: null,
    });
    expect(normalizeKeetaEvent({ eventType: "CREATED" })).toBeNull();
  });
});

describe("the menu and the pause (POST /v1/merchantUpdate/{merchantId})", () => {
  it("is a pull catalogue: the shared menu document, and an empty-body update that makes Keeta pull it", async () => {
    const catalogue = adapter().catalogue;
    if (catalogue?.mode !== "pull") throw new Error("not pull");
    const { ctx, requests } = context();

    expect(await catalogue.notifyMenuChanged(ctx)).toEqual({ kind: "accepted" });
    const update = requests.at(-1);
    expect(update?.url).toBe(`${API_BASE.SANDBOX}/v1/merchantUpdate/${KEETA_MERCHANT_ID}`);
    expect(update?.body).toBeUndefined();
    expect(update?.headers["Content-Type"]).toBeUndefined();
    expectSigned(update);

    const document = catalogue.menuDocument({
      externalMerchantId: KEETA_MERCHANT_ID,
      entries: [
        { ref: "r1", productId: "p1", name: "Coxinha", description: null, categoryName: "Salgados", priceCents: 790, imageUrl: null, externalId: null, storedImage: null },
      ],
      options: { menuName: "Cardápio", currency: "BRL" },
    }) as { items: { unit: string; status: string }[]; itemOffers: { price: { originalValue: number } }[] };
    expect(document.items[0]).toMatchObject({ unit: "UN", status: "AVAILABLE" });
    expect(document.itemOffers[0]?.price.originalValue).toBe(7.9);
  });

  it("offers the pause only when the host opts in, and closes and opens the store by merchantStatus", async () => {
    expect(adapter().availability).toBeUndefined();
    const availability = adapter({ pauseByStoreSwitch: true }).availability!;
    expect(availability.kind).toBe("switch");
    const { ctx, requests } = context();
    const until = new Date("2026-11-26T13:00:00Z");

    expect(
      await availability.pause(ctx, { merchantId: KEETA_MERCHANT_ID, until, reason: "kitchen", key: "k", timeZone: "America/Sao_Paulo" }),
    ).toEqual({ kind: "paused", externalId: null, until });
    await availability.resume(ctx, { merchantId: KEETA_MERCHANT_ID, externalId: null, key: null, sent: null });

    const updates = requests.filter((r) => r.url.includes("merchantUpdate"));
    expect(updates.map((r) => [r.url, r.body])).toEqual([
      [`${API_BASE.SANDBOX}/v1/merchantUpdate/${KEETA_MERCHANT_ID}`, '{"merchantStatus":"UNAVAILABLE"}'],
      [`${API_BASE.SANDBOX}/v1/merchantUpdate/${KEETA_MERCHANT_ID}`, '{"merchantStatus":"AVAILABLE"}'],
    ]);
  });
});

describe("the self-serve merchant authorization", () => {
  const authorization = createKeetaAuthorization({ apiBaseUrl: API_BASE });

  it("asks for the authorization URL with no token, signed with its sorted query", async () => {
    const url = "https://merchant.mykeeta.com/m/web/openapi/authorize?locale=pt&region=BR&appId=1#/app-activation";
    const { ctx, requests } = context(() => ({ status: 200, body: JSON.stringify({ merchantAuthorizationUrl: url }) }));

    expect(await authorization.authorizationUrl(ctx, { redirectUri: "https://host.example.test/keeta/back" })).toEqual({ kind: "ok", value: url });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `${API_BASE.SANDBOX}/oauth/authorization/url?clientId=app-id&redirectUri=${encodeURIComponent("https://host.example.test/keeta/back")}`,
    );
    expect(requests[0]?.headers.Authorization).toBeUndefined();
    expect(keetaSignatureString(requests[0]!.url, undefined)).toBe(
      `${API_BASE.SANDBOX}/oauth/authorization/url&clientId=app-id&redirectUri=https://host.example.test/keeta/back`,
    );
    expectSigned(requests[0]);
  });

  it("lists the stores of an authorization, Keeta's integer ids as text", async () => {
    const { ctx, requests } = context(() => ({ status: 200, body: JSON.stringify(KEETA_MERCHANT_INFO) }));
    const result = await authorization.authorizedShops(ctx, { authId: "41008" });

    expect(requests.at(-1)?.url).toBe(`${API_BASE.SANDBOX}/oauth/authorized/41008/merchantInfo?pageNum=1&pageSize=100`);
    expect(result).toEqual({
      kind: "ok",
      value: {
        brandId: "1001",
        brandName: "Sample Brand",
        shops: [
          {
            id: "159416882",
            name: "stbaxi3 - API Test store",
            address: "Rua Augusta, 500, São Paulo, SP, Brasil",
            latitude: -18.770281,
            longitude: 46.049568,
            timeZone: "America/Sao_Paulo",
          },
        ],
        page: { pageNum: 1, totalPage: 1, totalCount: 3 },
      },
    });
  });

  it("onboards a store: the software's id in the query, Keeta's in the body, the two URLs", async () => {
    const { ctx, requests } = context(() => ({ status: 201, body: "{}" }));
    const result = await authorization.onboard(ctx, {
      merchantId: KEETA_MERCHANT_ID,
      keetaMerchantId: 159416882,
      merchantDocument: { url: "https://host.example.test/keeta/LOJA-SP-001/merchant", apiKey: "store-key" },
      ordersWebhookUrl: "https://host.example.test/webhooks/marketplace/store/KEETA",
    });

    expect(result).toEqual({ kind: "ok", value: true });
    const put = requests.at(-1);
    expect(put?.method).toBe("PUT");
    expect(put?.url).toBe(`${API_BASE.SANDBOX}/v1/merchantOnboarding?merchantId=${KEETA_MERCHANT_ID}`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      keetaMerchantId: 159416882,
      getMerchantURL: { baseURL: "https://host.example.test/keeta/LOJA-SP-001/merchant", apiKey: "store-key" },
      ordersWebhookURL: "https://host.example.test/webhooks/marketplace/store/KEETA",
    });
    expectSigned(put);
  });

  it("reads the authorization webhook: opType 1 added, 2 revoked, anything else nothing", () => {
    expect(normalizeKeetaAuthorizationEvent(KEETA_AUTHORIZATION_WEBHOOK)).toEqual({
      authId: "41008",
      change: "AUTHORIZED",
      shopId: "478268",
      shopName: "10 Shanghai",
      clientId: "2666245991",
      at: new Date(1753151456973),
    });
    expect(normalizeKeetaAuthorizationEvent({ ...KEETA_AUTHORIZATION_WEBHOOK, opType: 2 })?.change).toBe("REVOKED");
    expect(normalizeKeetaAuthorizationEvent({ ...KEETA_AUTHORIZATION_WEBHOOK, opType: 3 })).toBeNull();
  });

  it("a 503 is a retry, an answer of another shape a refusal", async () => {
    const busy = context(() => ({ status: 503, body: "busy" }));
    expect(await authorization.authorizationUrl(busy.ctx, {})).toMatchObject({ kind: "retry" });
    const odd = context(() => ({ status: 200, body: JSON.stringify({ merchantAuthorizationUrl: "http://plain.test" }) }));
    expect(await authorization.authorizationUrl(odd.ctx, {})).toMatchObject({ kind: "refused" });
  });
});

describe("the Keeta adapter", () => {
  it("defaults to Keeta's documented server and Merchant Portal, and refuses a URL that is not https", () => {
    const subject = createKeetaAdapter({ copy: KEETA_ADAPTER_COPY_PT_BR });
    expect(subject.provider).toBe("KEETA");
    expect(subject.appLink({ externalOrderId: "1", externalDisplayId: null })).toBe(KEETA_PORTAL_URL);
    expect(KEETA_API_BASE_URL).toBe("https://open.mykeeta.com/api/open/opendelivery");
    expect(() => adapter({ portalUrl: "http://merchant.test" })).toThrow(/must be https/);
    expect(() => adapter({ apiBaseUrl: { SANDBOX: "nope", PRODUCTION: API_BASE.PRODUCTION } })).toThrow(/is not a URL/);
  });

  it("offers the eleven codes, labelled in both packs, item-unavailable preselectable", () => {
    for (const copy of [KEETA_ADAPTER_COPY_PT_BR, KEETA_ADAPTER_COPY_EN_US]) {
      const reasons = createKeetaAdapter({ copy }).cancellationReasons();
      expect(reasons).toHaveLength(11);
      for (const reason of reasons) expect(reason.label.trim()).not.toBe("");
      expect(reasons.filter((reason) => reason.itemUnavailable).map((reason) => reason.code)).toEqual(["UNAVAILABLE_ITEM"]);
    }
  });

  it("calls the production base for a production connection", async () => {
    const { ctx, requests } = context(() => ({ status: 202, body: "" }));
    const production: AdapterCallContext = { ...ctx, environment: "PRODUCTION" };
    await adapter().confirm(production, order, { preparationMinutes: null });
    expect(requests.every((r) => r.url.startsWith(API_BASE.PRODUCTION))).toBe(true);
  });
});
