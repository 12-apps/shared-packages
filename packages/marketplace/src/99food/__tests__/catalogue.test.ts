import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { stableUuid } from "../../core/catalogue-ids";
import type { CatalogueCallContext, CatalogueMenuEntry } from "../../core/catalogue-port";
import { createNinetyNineFoodAdapter } from "..";
import { openDeliveryMenuDocument } from "../catalogue";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../en-US";
import { API_BASE, PORTAL } from "./fixtures";

/**
 * 99Food's catalogue is PULL, on Open Delivery v1.7.1 (FUT-4768): the host
 * serves the `Merchant` document 99Food reads, and the adapter builds its
 * menu part (`menus`, `categories`, `items`, `itemOffers`, the price on the
 * offer) and tells 99Food it changed (`POST /v1/merchantUpdate`, no body).
 */

const entry = (productId: string, categoryName: string, priceCents: number): CatalogueMenuEntry => ({
  ref: `pub-${productId}`,
  productId,
  externalId: null,
  name: productId.toUpperCase(),
  description: null,
  imageUrl: productId === "p-1" ? "https://img.test/p1.png" : null,
  categoryName,
  priceCents,
  storedImage: null,
});

const adapter = createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE, portalUrl: PORTAL });

describe("99Food catalogue, the menu document", () => {
  it("lists every published item under its category, its price on the offer", () => {
    const document = openDeliveryMenuDocument({
      externalMerchantId: "m-1",
      entries: [entry("p-1", "Burgers", 2500), entry("p-2", "Drinks", 600), entry("p-3", "Burgers", 3100)],
      options: { menuName: "Menu", currency: "XTS" },
    });

    expect(document.menus).toEqual([
      {
        id: stableUuid("m-1:menu"),
        name: "Menu",
        externalCode: "menu",
        categoryId: [stableUuid("m-1:category:Burgers"), stableUuid("m-1:category:Drinks")],
      },
    ]);
    expect(document.categories.map((category) => [category.name, category.index, category.itemOfferId.length])).toEqual([
      ["Burgers", 0, 2],
      ["Drinks", 1, 1],
    ]);
    expect(document.items[0]).toEqual({
      id: stableUuid("pub-p-1:item"),
      name: "P-1",
      description: "",
      externalCode: "p-1",
      status: "AVAILABLE",
      unit: "UN",
      image: { URL: "https://img.test/p1.png" },
    });
    expect(document.items[1]).not.toHaveProperty("image");
    expect(document.itemOffers[2]).toEqual({
      id: stableUuid("pub-p-3:offer"),
      itemId: stableUuid("pub-p-3:item"),
      index: 2,
      status: "AVAILABLE",
      price: { value: 31, originalValue: 31, currency: "XTS" },
    });
  });

  it("is the adapter's pull capability", () => {
    expect(adapter.catalogue?.mode).toBe("pull");
  });
});

describe("99Food catalogue, telling it the menu changed", () => {
  function context(answer: MarketplaceHttpResponse) {
    const recorded: MarketplaceHttpRequest[] = [];
    const ctx: CatalogueCallContext = {
      http: async (request) => {
        recorded.push(request);
        return request.url.endsWith("/oauth/token")
          ? { status: 200, body: JSON.stringify({ access_token: "tok", expires_in: 3600 }) }
          : answer;
      },
      credentials: { clientId: "app-id", clientSecret: "app-secret", webhookSecret: null },
      environment: "SANDBOX",
      tokens: new Map(),
      now: new Date("2026-11-13T12:00:00.000Z"),
      externalMerchantId: "m-1",
      loadImage: async () => null,
      category: (_name, resolve) => resolve(),
      forgetCategory: async () => undefined,
    };
    return { ctx, requests: recorded };
  }

  it("POSTs merchantUpdate with no body, naming the merchant; 204 is done", async () => {
    if (adapter.catalogue?.mode !== "pull") throw new Error("expected a pull catalogue");
    const { ctx, requests } = context({ status: 204, body: "" });

    expect(await adapter.catalogue.notifyMenuChanged(ctx)).toEqual({ kind: "accepted" });
    const notify = requests.at(-1);
    expect(notify?.method).toBe("POST");
    expect(notify?.url).toBe(`${API_BASE.SANDBOX}/v1/merchantUpdate`);
    expect(notify?.headers).toEqual({ Authorization: "Bearer tok", "X-App-MerchantId": "m-1" });
    expect(notify?.body).toBeUndefined();
  });

  it("answers a 503 as a retry and a 404 as a refusal", async () => {
    if (adapter.catalogue?.mode !== "pull") throw new Error("expected a pull catalogue");
    expect((await adapter.catalogue.notifyMenuChanged(context({ status: 503, body: "" }).ctx)).kind).toBe("retry");
    expect((await adapter.catalogue.notifyMenuChanged(context({ status: 404, body: "no merchant" }).ctx)).kind).toBe("refused");
  });
});
