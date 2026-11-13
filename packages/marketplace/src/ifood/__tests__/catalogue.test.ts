import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import type { CatalogueCallContext, CatalogueImage, CatalogueItemOut } from "../../core/catalogue-port";
import { IFOOD_CATALOGUE, ifoodItemId, ifoodProductId } from "../catalogue";

/**
 * The iFood catalogue's request shapes against a fake HTTP client (FUT-4768):
 * the token, the category found or created by name, the photo uploaded as a
 * base64 data URL, the `PUT /items` body, and the withdraw's `PATCH
 * /items/status`. Every URL is the Catalog API v2.0's, from the portal's
 * Introduction and Endpoints pages (read 2026-11-13).
 */

const BASE = "https://merchant-api.ifood.com.br/catalog/v2.0/merchants/m-1";
const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok", expiresIn: 3600 }) };

const ITEM: CatalogueItemOut = {
  ref: "pub-1",
  productId: "p-1",
  externalId: null,
  name: "X-Burger",
  description: "Bun, beef, cheese",
  imageUrl: "https://img.test/x.png",
  categoryName: "Burgers",
  priceCents: 2550,
};

function context(answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse, image: CatalogueImage | null = null) {
  const recorded: MarketplaceHttpRequest[] = [];
  const ctx: CatalogueCallContext = {
    http: async (request) => {
      recorded.push(request);
      return answer(request);
    },
    credentials: { clientId: "app-id", clientSecret: "app-secret", webhookSecret: null },
    environment: "SANDBOX",
    tokens: new Map(),
    now: new Date("2026-11-13T12:00:00.000Z"),
    externalMerchantId: "m-1",
    loadImage: async () => image,
  };
  return { ctx, requests: recorded };
}

/** iFood as the fake answers it: an existing "Burgers" category unless told otherwise. */
function ifood(options: { categories?: unknown; put?: MarketplaceHttpResponse; patch?: MarketplaceHttpResponse } = {}) {
  return (request: MarketplaceHttpRequest): MarketplaceHttpResponse => {
    if (request.url.endsWith("/oauth/token")) return TOKEN;
    if (request.method === "GET") return { status: 200, body: JSON.stringify(options.categories ?? [{ id: "cat-9", name: "burgers" }]) };
    if (request.url.endsWith("/categories")) return { status: 201, body: JSON.stringify({ id: "cat-new", name: "Burgers" }) };
    if (request.url.endsWith("/image/upload")) return { status: 200, body: JSON.stringify({ imagePath: "m-1/x.png" }) };
    if (request.method === "PATCH") return options.patch ?? { status: 200, body: "{}" };
    return options.put ?? { status: 200, body: "{}" };
  };
}

const json = (request: MarketplaceHttpRequest | undefined): unknown => JSON.parse(request?.body ?? "null");

describe("iFood catalogue, publish", () => {
  it("finds the category by name and PUTs the item with the price in reais, the product id as its external code", async () => {
    const { ctx, requests } = context(ifood());

    const result = await IFOOD_CATALOGUE.publishItem(ctx, ITEM);

    expect(result).toEqual({ kind: "published", externalId: ifoodItemId("pub-1") });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token",
      `GET ${BASE}/categories`,
      `PUT ${BASE}/items`,
    ]);
    expect(requests[2]?.headers.Authorization).toBe("Bearer tok");
    expect(json(requests[2])).toEqual({
      item: {
        id: ifoodItemId("pub-1"),
        type: "DEFAULT",
        categoryId: "cat-9",
        status: "AVAILABLE",
        price: { value: 25.5 },
        externalCode: "p-1",
        productId: ifoodProductId("pub-1"),
      },
      products: [{ id: ifoodProductId("pub-1"), name: "X-Burger", description: "Bun, beef, cheese", externalCode: "p-1-product" }],
      optionGroups: [],
      options: [],
    });
  });

  it("creates a missing category, and uploads the photo the host's loader read", async () => {
    const { ctx, requests } = context(ifood({ categories: [] }), { contentType: "image/png", base64: "AAAA" });

    await IFOOD_CATALOGUE.publishItem(ctx, ITEM);

    const post = requests.find((request) => request.method === "POST" && request.url.endsWith("/categories"));
    expect(json(post)).toEqual({ name: "Burgers", status: "AVAILABLE", template: "DEFAULT" });
    const upload = requests.find((request) => request.url.endsWith("/image/upload"));
    expect(json(upload)).toEqual({ image: "data:image/png;base64,AAAA" });
    const put = json(requests.at(-1)) as { item: { categoryId: string }; products: { imagePath?: string }[] };
    expect(put.item.categoryId).toBe("cat-new");
    expect(put.products[0]?.imagePath).toBe("m-1/x.png");
  });

  it("names the same item on every retry: the ids are derived from the publication", () => {
    expect(ifoodItemId("pub-1")).toBe(ifoodItemId("pub-1"));
    expect(ifoodItemId("pub-1")).not.toBe(ifoodItemId("pub-2"));
    expect(ifoodItemId("pub-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("answers iFood's refusal with iFood's own words, and a 429 or 5xx as a retry", async () => {
    const refused = context(ifood({ put: { status: 422, body: "Item has no price" } }));
    expect(await IFOOD_CATALOGUE.publishItem(refused.ctx, ITEM)).toEqual({
      kind: "refused",
      status: 422,
      message: "Item has no price",
    });
    const limited = context(ifood({ put: { status: 429, body: "slow down" } }));
    expect((await IFOOD_CATALOGUE.publishItem(limited.ctx, ITEM)).kind).toBe("retry");
  });

  it("forgets a token iFood refused, so the retry fetches another", async () => {
    const { ctx } = context(ifood({ put: { status: 401, body: "" } }));
    expect((await IFOOD_CATALOGUE.publishItem(ctx, ITEM)).kind).toBe("retry");
    expect(ctx.tokens.size).toBe(0);
  });

  it("is a retry when the call never got an answer", async () => {
    const { ctx } = context(() => {
      throw new Error("socket hang up");
    });
    expect(await IFOOD_CATALOGUE.publishItem(ctx, ITEM)).toEqual({ kind: "retry", reason: "socket hang up" });
  });
});

describe("iFood catalogue, withdraw", () => {
  it("pauses the item by the id the publish answered", async () => {
    const { ctx, requests } = context(ifood());

    const result = await IFOOD_CATALOGUE.withdrawItem(ctx, { ref: "pub-1", productId: "p-1", externalId: "item-77" });

    expect(result).toEqual({ kind: "accepted" });
    expect(requests.at(-1)?.method).toBe("PATCH");
    expect(requests.at(-1)?.url).toBe(`${BASE}/items/status`);
    expect(json(requests.at(-1))).toEqual({ itemId: "item-77", status: "UNAVAILABLE" });
  });

  it("treats an item iFood does not have as already out", async () => {
    const { ctx, requests } = context(ifood({ patch: { status: 404, body: "not found" } }));

    expect(await IFOOD_CATALOGUE.withdrawItem(ctx, { ref: "pub-1", productId: "p-1", externalId: null })).toEqual({ kind: "accepted" });
    expect(json(requests.at(-1))).toEqual({ itemId: ifoodItemId("pub-1"), status: "UNAVAILABLE" });
  });
});
