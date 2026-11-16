import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import type { CatalogueReadContext } from "../../core/catalogue-read-port";
import { createIfoodAdapter } from "..";
import { IFOOD_CATALOGUE_READER } from "../catalogue-read";
import { IFOOD_IMAGE_BASE_URL, photoOf } from "../catalogue-snapshot";
import { IFOOD_ADAPTER_COPY_EN_US } from "../en-US";

/**
 * iFood's catalogue READ (FUT-951) against a fake HTTP client answering the
 * Catalog API v2.0's shapes: the four lists of the portal Introduction's
 * `PUT /items` example (item, products with their group links, optionGroups
 * with optionIds, options naming a product), as `GET
 * /categories/{id}/items` is ESTIMATED to answer them.
 */

const BASE = "https://merchant-api.ifood.com.br/catalog/v2.0/merchants/m-1";
const TOKEN_URL = "https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token";
const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok", expiresIn: 3600 }) };

type Answer = (request: MarketplaceHttpRequest) => MarketplaceHttpResponse;

function context(answer: Answer) {
  const requests: MarketplaceHttpRequest[] = [];
  const ctx: CatalogueReadContext = {
    http: async (request) => {
      requests.push(request);
      return answer(request);
    },
    credentials: { clientId: "app-id", clientSecret: "app-secret", webhookSecret: null },
    environment: "PRODUCTION",
    tokens: new Map(),
    now: new Date("2026-11-16T12:00:00.000Z"),
    externalMerchantId: "m-1",
  };
  return { ctx, requests, calls: () => requests.map((request) => `${request.method} ${request.url}`) };
}

const respond = (status: number, body: unknown): MarketplaceHttpResponse => ({
  status,
  body: typeof body === "string" ? body : JSON.stringify(body),
});

/** A burger with a size group (required, one of two) and an add-on group (up to two), as iFood holds it. */
const BURGERS_ITEMS = {
  categoryId: "cat-1",
  items: [
    {
      id: "it-1",
      type: "DEFAULT",
      categoryId: "cat-1",
      status: "AVAILABLE",
      price: { value: 25.9 },
      externalCode: "BURGER_001",
      productId: "pr-1",
    },
  ],
  products: [
    {
      id: "pr-1",
      name: "X-Burger",
      description: "Bun, beef, cheese",
      externalCode: "BURGER_PROD_001",
      imagePath: "202611/x-burger.jpg",
      optionGroups: [
        { id: "og-size", min: 1, max: 1 },
        { id: "og-extra", min: 0, max: 2 },
      ],
    },
    { id: "pr-small", name: "Small" },
    { id: "pr-large", name: "Large", imagePath: "https://cdn.example.test/large.png" },
    { id: "pr-bacon", name: "Bacon", description: "Crispy" },
    { id: "pr-egg", name: "Egg" },
  ],
  optionGroups: [
    { id: "og-size", name: "Size", status: "AVAILABLE", optionGroupType: "OFFER_UNIT", optionIds: ["op-small", "op-large"] },
    { id: "og-extra", name: "Extras", status: "AVAILABLE", externalCode: "EXTRAS", optionIds: ["op-bacon", "op-egg"] },
  ],
  options: [
    { id: "op-small", productId: "pr-small", status: "AVAILABLE", price: { value: 0 } },
    { id: "op-large", productId: "pr-large", status: "AVAILABLE", price: { value: 6.5 } },
    { id: "op-bacon", productId: "pr-bacon", status: "AVAILABLE", price: { value: 4.99 }, externalCode: "BACON" },
    { id: "op-egg", productId: "pr-egg", status: "UNAVAILABLE", price: { value: 1.005 } },
  ],
};

/** iFood answering one category list and each category's items from a table; anything else 404. */
function ifood(categories: unknown, itemsByCategory: Record<string, MarketplaceHttpResponse>): Answer {
  return (request) => {
    if (request.url === TOKEN_URL) return TOKEN;
    if (request.url === `${BASE}/categories`) return respond(200, categories);
    const match = /\/categories\/([^/]+)\/items$/.exec(request.url);
    return (match && itemsByCategory[decodeURIComponent(match[1] ?? "")]) || respond(404, { message: "not found" });
  };
}

describe("iFood catalogue read, the happy path", () => {
  it("reads categories, then each category's items, with sizes and add-ons as option groups in cents", async () => {
    const { ctx, requests, calls } = context(ifood([{ id: "cat-1", name: "Burgers", status: "AVAILABLE" }], { "cat-1": respond(200, BURGERS_ITEMS) }));

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    expect(calls()).toEqual([`POST ${TOKEN_URL}`, `GET ${BASE}/categories`, `GET ${BASE}/categories/cat-1/items`]);
    expect(requests[1]?.headers.Authorization).toBe("Bearer tok");
    expect(result).toEqual({
      kind: "snapshot",
      snapshot: {
        notices: [],
        categories: [
          {
            externalId: "cat-1",
            externalCode: null,
            name: "Burgers",
            available: true,
            items: [
              {
                externalId: "it-1",
                externalCode: "BURGER_001",
                name: "X-Burger",
                description: "Bun, beef, cheese",
                priceCents: 2590,
                photoUrl: `${IFOOD_IMAGE_BASE_URL}202611/x-burger.jpg`,
                available: true,
                warnings: [],
                optionGroups: [
                  {
                    externalId: "og-size",
                    externalCode: null,
                    name: "Size",
                    min: 1,
                    max: 1,
                    available: true,
                    options: [
                      { externalId: "op-small", externalCode: null, name: "Small", description: null, priceDeltaCents: 0, photoUrl: null, available: true },
                      {
                        externalId: "op-large",
                        externalCode: null,
                        name: "Large",
                        description: null,
                        priceDeltaCents: 650,
                        photoUrl: "https://cdn.example.test/large.png",
                        available: true,
                      },
                    ],
                  },
                  {
                    externalId: "og-extra",
                    externalCode: "EXTRAS",
                    name: "Extras",
                    min: 0,
                    max: 2,
                    available: true,
                    options: [
                      { externalId: "op-bacon", externalCode: "BACON", name: "Bacon", description: "Crispy", priceDeltaCents: 499, photoUrl: null, available: true },
                      // 1.005 reais rounds half up to 101 cents, not the float's 100.
                      { externalId: "op-egg", externalCode: null, name: "Egg", description: null, priceDeltaCents: 101, photoUrl: null, available: false },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("is iFood's adapter's reader, and the push is left as it was", () => {
    const adapter = createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US });
    expect(adapter.catalogueReader).toBe(IFOOD_CATALOGUE_READER);
    expect(adapter.catalogue?.mode).toBe("push");
  });
});

describe("iFood catalogue read, one category per call", () => {
  it("reads every category in the list's order with the one token, and keeps an empty one", async () => {
    const items = (id: string, name: string, price: number) =>
      respond(200, { items: [{ id, productId: `p-${id}`, price: { value: price } }], products: [{ id: `p-${id}`, name }], optionGroups: [], options: [] });
    const { ctx, calls } = context(
      ifood(
        [
          { id: "c-a", name: "Starters" },
          { id: "c-b", name: "Mains", status: "UNAVAILABLE" },
          { id: "c c", name: "Empty" },
        ],
        { "c-a": items("i-a", "Fries", 12), "c-b": items("i-b", "Steak", 59.9), "c c": respond(200, { items: [] }) },
      ),
    );

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    expect(calls()).toEqual([
      `POST ${TOKEN_URL}`,
      `GET ${BASE}/categories`,
      `GET ${BASE}/categories/c-a/items`,
      `GET ${BASE}/categories/c-b/items`,
      `GET ${BASE}/categories/c%20c/items`,
    ]);
    if (result.kind !== "snapshot") throw new Error(`expected a snapshot, got ${result.kind}`);
    expect(result.snapshot.categories.map((category) => [category.name, category.available, category.items.map((item) => [item.name, item.priceCents])])).toEqual([
      ["Starters", true, [["Fries", 1200]]],
      ["Mains", false, [["Steak", 5990]]],
      ["Empty", true, []],
    ]);
  });
});

describe("iFood catalogue read, what it cannot map is said, never dropped", () => {
  const read = (answer: unknown) =>
    IFOOD_CATALOGUE_READER.read(context(ifood([{ id: "cat-1", name: "Burgers" }], { "cat-1": respond(200, answer) })).ctx);

  it("an item with no price and no photo is read with priceCents null, a PRICE_MISSING warning, and no photo", async () => {
    const result = await read({ items: [{ id: "it-1", productId: "pr-1", status: "AVAILABLE" }], products: [{ id: "pr-1", name: "Mystery" }] });

    if (result.kind !== "snapshot") throw new Error(`expected a snapshot, got ${result.kind}`);
    expect(result.snapshot.categories[0]?.items[0]).toMatchObject({
      name: "Mystery",
      priceCents: null,
      photoUrl: null,
      warnings: [{ code: "PRICE_MISSING", subject: null, detail: null }],
    });
  });

  it("an item it cannot read at all (no name) is a notice on the snapshot; its neighbours still arrive", async () => {
    const result = await read({
      items: [
        { id: "it-x", productId: "pr-gone", price: { value: 5 } },
        { id: "it-1", productId: "pr-1", price: { value: 5 } },
      ],
      products: [{ id: "pr-1", name: "Soda" }],
    });

    if (result.kind !== "snapshot") throw new Error(`expected a snapshot, got ${result.kind}`);
    expect(result.snapshot.categories[0]?.items.map((item) => item.name)).toEqual(["Soda"]);
    expect(result.snapshot.notices).toEqual([
      expect.objectContaining({ code: "ITEM_UNREADABLE", categoryExternalId: "cat-1", externalId: "it-x" }),
    ]);
  });

  it("an unreadable group, option, option price, photo and item type are warnings on the item", async () => {
    const result = await read({
      items: [{ id: "it-1", type: "PIZZA", productId: "pr-1", price: { value: "10" } }],
      products: [
        { id: "pr-1", name: "Pizza", imagePath: 42, optionGroups: [{ id: "og-ok", min: 0, max: 1 }, { id: "og-bad", min: 3, max: 1 }, { id: "og-missing", min: 0, max: 1 }] },
        { id: "pr-a", name: "Olives" },
      ],
      optionGroups: [
        { id: "og-ok", name: "Toppings", optionIds: ["op-a", "op-ghost"] },
        { id: "og-bad", name: "Crust", optionIds: ["op-a"] },
      ],
      options: [{ id: "op-a", productId: "pr-a" }],
    });

    if (result.kind !== "snapshot") throw new Error(`expected a snapshot, got ${result.kind}`);
    const item = result.snapshot.categories[0]?.items[0];
    expect(item?.priceCents).toBeNull();
    expect(item?.photoUrl).toBeNull();
    expect(item?.optionGroups).toEqual([
      expect.objectContaining({ externalId: "og-ok", options: [expect.objectContaining({ name: "Olives", priceDeltaCents: null })] }),
    ]);
    expect(item?.warnings.map((entry) => `${entry.code}:${entry.subject ?? "item"}`)).toEqual([
      "ITEM_TYPE_UNSUPPORTED:item",
      "PRICE_MISSING:item",
      "PHOTO_UNREADABLE:item",
      "OPTION_PRICE_MISSING:op-a",
      "OPTION_UNREADABLE:op-ghost",
      "OPTION_GROUP_UNREADABLE:og-bad",
      "OPTION_GROUP_UNREADABLE:og-missing",
    ]);
  });

  it("a category with no id, and one whose items answer 404, are notices; the rest is read", async () => {
    const { ctx } = context(
      ifood(
        [{ name: "Ghost" }, { id: "cat-gone", name: "Deleted" }, { id: "cat-1", name: "Burgers" }],
        { "cat-1": respond(200, BURGERS_ITEMS) },
      ),
    );

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    if (result.kind !== "snapshot") throw new Error(`expected a snapshot, got ${result.kind}`);
    expect(result.snapshot.categories.map((category) => category.name)).toEqual(["Burgers"]);
    expect(result.snapshot.notices.map((notice) => `${notice.code}:${notice.categoryExternalId ?? "none"}`)).toEqual([
      "CATEGORY_UNREADABLE:none",
      "CATEGORY_UNREADABLE:cat-gone",
    ]);
  });
});

describe("iFood catalogue read, an unexpected shape is said, never an empty menu", () => {
  const snapshotOf = async (categories: unknown, itemsByCategory: Record<string, MarketplaceHttpResponse>) => {
    const result = await IFOOD_CATALOGUE_READER.read(context(ifood(categories, itemsByCategory)).ctx);
    if (result.kind !== "snapshot") throw new Error(`expected a snapshot, got ${result.kind}`);
    return result.snapshot;
  };
  const codes = (snapshot: { notices: { code: string; categoryExternalId: string | null; externalId: string | null }[] }) =>
    snapshot.notices.map((notice) => `${notice.code}:${notice.categoryExternalId ?? "none"}:${notice.externalId ?? "none"}`);

  it("a category answered without an `items` list is CATEGORY_UNREADABLE, and the other categories are still read", async () => {
    const snapshot = await snapshotOf(
      [
        { id: "cat-renamed", name: "Renamed" },
        { id: "cat-array", name: "Array" },
        { id: "cat-1", name: "Burgers" },
      ],
      {
        "cat-renamed": respond(200, { data: [{ id: "it-9", productId: "pr-9" }] }),
        "cat-array": respond(200, [{ id: "it-9" }]),
        "cat-1": respond(200, BURGERS_ITEMS),
      },
    );

    expect(snapshot.categories.map((category) => category.name)).toEqual(["Burgers"]);
    expect(codes(snapshot)).toEqual(["CATEGORY_UNREADABLE:cat-renamed:none", "CATEGORY_UNREADABLE:cat-array:none"]);
    expect(snapshot.notices[0]?.detail).toContain('"data"');
  });

  it("a category entry that is not an object is CATEGORY_UNREADABLE", async () => {
    const snapshot = await snapshotOf(["Burgers", 7, { id: "cat-1", name: "Burgers" }], { "cat-1": respond(200, BURGERS_ITEMS) });

    expect(snapshot.categories).toHaveLength(1);
    expect(codes(snapshot)).toEqual(["CATEGORY_UNREADABLE:none:none", "CATEGORY_UNREADABLE:none:none"]);
    expect(snapshot.notices.map((notice) => notice.detail)).toEqual(["Burgers", "7"]);
  });

  it("an item entry that is not an object is ITEM_UNREADABLE in its category", async () => {
    const snapshot = await snapshotOf([{ id: "cat-1", name: "Burgers" }], {
      "cat-1": respond(200, { ...BURGERS_ITEMS, items: ["it-1", null, ...BURGERS_ITEMS.items] }),
    });

    expect(snapshot.categories[0]?.items.map((item) => item.name)).toEqual(["X-Burger"]);
    expect(codes(snapshot)).toEqual(["ITEM_UNREADABLE:cat-1:none", "ITEM_UNREADABLE:cat-1:none"]);
  });

  it("a group link that is not an object, or links that are not a list, are OPTION_GROUP_UNREADABLE", async () => {
    const products = (optionGroups: unknown) => [{ ...BURGERS_ITEMS.products[0], optionGroups }, ...BURGERS_ITEMS.products.slice(1)];
    const listed = await snapshotOf([{ id: "cat-1", name: "Burgers" }], {
      "cat-1": respond(200, { ...BURGERS_ITEMS, products: products(["og-size", { id: "og-extra", min: 0, max: 2 }]) }),
    });
    const notAList = await snapshotOf([{ id: "cat-1", name: "Burgers" }], {
      "cat-1": respond(200, { ...BURGERS_ITEMS, products: products({ id: "og-size" }) }),
    });

    const item = listed.categories[0]?.items[0];
    expect(item?.optionGroups.map((group) => group.name)).toEqual(["Extras"]);
    expect(item?.warnings).toEqual([{ code: "OPTION_GROUP_UNREADABLE", subject: null, detail: '"og-size"' }]);
    expect(notAList.categories[0]?.items[0]?.optionGroups).toEqual([]);
    expect(notAList.categories[0]?.items[0]?.warnings).toEqual([{ code: "OPTION_GROUP_UNREADABLE", subject: null, detail: '{"id":"og-size"}' }]);
  });

  it("an option id that is not an id is OPTION_UNREADABLE on its group", async () => {
    const optionGroups = [{ ...BURGERS_ITEMS.optionGroups[0], optionIds: ["op-small", 5, { id: "op-large" }] }, BURGERS_ITEMS.optionGroups[1]];
    const snapshot = await snapshotOf([{ id: "cat-1", name: "Burgers" }], { "cat-1": respond(200, { ...BURGERS_ITEMS, optionGroups }) });

    const item = snapshot.categories[0]?.items[0];
    expect(item?.optionGroups[0]?.options.map((option) => option.name)).toEqual(["Small"]);
    expect(item?.warnings).toEqual([
      { code: "OPTION_UNREADABLE", subject: "og-size", detail: "5" },
      { code: "OPTION_UNREADABLE", subject: "og-size", detail: '{"id":"op-large"}' },
    ]);
  });
});

describe("iFood catalogue read, photo paths", () => {
  it.each([
    ["202611/a%20b.jpg", "202611/a%20b.jpg"],
    ["/202611/a b.jpg", "202611/a%20b.jpg"],
    ["202611/100%.jpg", "202611/100%25.jpg"],
    ["202611/pão.jpg", "202611/p%C3%A3o.jpg"],
    ["202611/x-burger_1.jpg", "202611/x-burger_1.jpg"],
  ])("%s is served as %s, never encoded twice", (path, served) => {
    expect(photoOf(path, null)).toEqual({ url: `${IFOOD_IMAGE_BASE_URL}${served}` });
  });
});

describe("iFood catalogue read, failures", () => {
  it("a 401 drops the cached token and asks again with a fresh one", async () => {
    let refusals = 1;
    const { ctx, calls } = context((request) => {
      if (request.url === TOKEN_URL) return TOKEN;
      if (request.url === `${BASE}/categories` && refusals-- > 0) return respond(401, "expired");
      return request.url === `${BASE}/categories` ? respond(200, []) : respond(404, "");
    });
    ctx.tokens.set("IFOOD:PRODUCTION:app-id", { token: "stale", expiresAt: ctx.now.getTime() + 3_600_000 });

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    expect(result).toEqual({ kind: "snapshot", snapshot: { categories: [], notices: [] } });
    expect(calls()).toEqual([`GET ${BASE}/categories`, `POST ${TOKEN_URL}`, `GET ${BASE}/categories`]);
    expect(ctx.tokens.get("IFOOD:PRODUCTION:app-id")?.token).toBe("tok");
  });

  it("a second 401 with a fresh token is a retry, and the token is not kept", async () => {
    const { ctx } = context((request) => (request.url === TOKEN_URL ? TOKEN : respond(401, "no")));

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    expect(result).toEqual({ kind: "retry", reason: "iFood refused a fresh token" });
    expect(ctx.tokens.size).toBe(0);
  });

  it("the token grant refused is CREDENTIALS, with iFood's words, and no catalogue call is made", async () => {
    const { ctx, calls } = context(() => respond(401, { message: "invalid client" }));

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    expect(result).toEqual({ kind: "refused", code: "CREDENTIALS", status: 401, message: '{"message":"invalid client"}' });
    expect(calls()).toEqual([`POST ${TOKEN_URL}`]);
  });

  it.each([
    [429, "rate limited"],
    [500, "boom"],
    [503, "down"],
  ])("a %i is a retry", async (status, body) => {
    const { ctx } = context((request) => (request.url === TOKEN_URL ? TOKEN : respond(status, body)));

    const result = await IFOOD_CATALOGUE_READER.read(ctx);

    expect(result).toEqual({ kind: "retry", reason: `status ${status}: ${body}` });
  });

  it("a 5xx on a category's items ends the read as a retry, not a partial menu", async () => {
    const { ctx } = context(ifood([{ id: "cat-1", name: "Burgers" }], { "cat-1": respond(502, "bad gateway") }));

    expect(await IFOOD_CATALOGUE_READER.read(ctx)).toEqual({ kind: "retry", reason: "status 502: bad gateway" });
  });

  it("a call with no answer is a retry", async () => {
    const { ctx } = context(() => {
      throw new Error("socket hang up");
    });

    expect(await IFOOD_CATALOGUE_READER.read(ctx)).toEqual({ kind: "retry", reason: "socket hang up" });
  });

  it.each([403, 404])("a %i on the category list is NOT_AUTHORIZED: the merchant did not authorize this app", async (status) => {
    const { ctx } = context((request) => (request.url === TOKEN_URL ? TOKEN : respond(status, { message: "merchant not allowed" })));

    expect(await IFOOD_CATALOGUE_READER.read(ctx)).toEqual({
      kind: "refused",
      code: "NOT_AUTHORIZED",
      status,
      message: '{"message":"merchant not allowed"}',
    });
  });

  it("a 403 on a category's items is NOT_AUTHORIZED too", async () => {
    const { ctx } = context(ifood([{ id: "cat-1", name: "Burgers" }], { "cat-1": respond(403, "module not enabled") }));

    expect(await IFOOD_CATALOGUE_READER.read(ctx)).toMatchObject({ kind: "refused", code: "NOT_AUTHORIZED", status: 403 });
  });

  it("another 4xx is REFUSED, and an answer that is not a list is REFUSED, never a silent empty menu", async () => {
    const refused = context((request) => (request.url === TOKEN_URL ? TOKEN : respond(400, "bad request")));
    expect(await IFOOD_CATALOGUE_READER.read(refused.ctx)).toEqual({ kind: "refused", code: "REFUSED", status: 400, message: "bad request" });

    const odd = context((request) => (request.url === TOKEN_URL ? TOKEN : respond(200, { categories: "?" })));
    expect(await IFOOD_CATALOGUE_READER.read(odd.ctx)).toMatchObject({ kind: "refused", code: "REFUSED", status: 200 });
  });
});
