import { describe, expect, it } from "vitest";

import { outboundResultOf, type MarketplaceAdapter } from "../core/adapter";
import { CatalogueRetryError, type CatalogueJobPayload } from "../core/catalogue-job";
import type { CatalogueItem, PullCatalogue, PushCatalogue } from "../core/catalogue-port";
import type { MarketplaceCataloguePort } from "../core/ports";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { TENANT, createHarness, scriptedHttp, type Harness } from "./harness";

/**
 * Catalogue publishing (FUT-4768), driven through the engine with FAKE
 * marketplaces — one that is written to (push), one that reads a menu the host
 * serves (pull), one with no catalogue — and nothing in the engine naming any
 * of them: the owner's rule, "only an adapter is made for each one".
 *
 * The state machine under test: publish → PUBLISHED; refused → FAILED with the
 * marketplace's reason; retry; withdraw → WITHDRAWN; a double tap; a withdraw
 * while publishing; the sweep.
 */

const PUSHY = "PUSHY";
const PULLY = "PULLY";
const BARE = "BARE";

const pushCatalogue: PushCatalogue = {
  mode: "push",
  publishItem: async (ctx, item) => {
    const response = await ctx.http({
      method: "PUT",
      url: `https://pushy.test/${ctx.externalMerchantId}/items/${item.ref}`,
      headers: {},
      body: JSON.stringify({ name: item.name, price: item.priceCents, category: item.categoryName }),
    });
    const result = outboundResultOf(response);
    return result.kind === "accepted" ? { kind: "published", externalId: `px-${item.productId}` } : result;
  },
  withdrawItem: async (ctx, item) =>
    outboundResultOf(await ctx.http({ method: "PATCH", url: `https://pushy.test/items/${item.externalId ?? item.ref}/off`, headers: {} })),
};

const pullCatalogue: PullCatalogue = {
  mode: "pull",
  menuDocument: ({ externalMerchantId, entries, options }) => ({
    merchant: externalMerchantId,
    currency: options.currency,
    items: entries.map((entry) => ({ code: entry.productId, price: entry.priceCents })),
  }),
  notifyMenuChanged: async (ctx) => outboundResultOf(await ctx.http({ method: "POST", url: "https://pully.test/changed", headers: {} })),
};

function fakeAdapter(provider: string, catalogue?: MarketplaceAdapter["catalogue"]): MarketplaceAdapter {
  return {
    provider,
    capabilities: {
      apiConfirm: false,
      apiCancel: false,
      cancelAfterAccept: false,
      asyncCancellationOutcome: false,
      perOrderAppLink: false,
      confirmTakesPreparationTime: false,
    },
    normalize: () => null,
    readSignature: () => null,
    verifySignature: () => false,
    cancellationReasons: () => [],
    confirm: async () => ({ kind: "accepted" }),
    requestCancellation: async () => ({ kind: "accepted" }),
    ...(catalogue ? { catalogue } : {}),
    appLink: () => "https://portal.test/",
  };
}

const BURGER: CatalogueItem = {
  name: "Burger",
  description: "Bun and beef",
  imageUrl: "https://img.test/burger.png",
  categoryName: "Burgers",
  priceCents: 2500,
};

function hostCatalogue(products: Record<string, CatalogueItem> = { "p-1": BURGER }): MarketplaceCataloguePort {
  return {
    items: async (_clientId, ids) => new Map(ids.flatMap((id) => (products[id] ? [[id, products[id]] as const] : []))),
    image: async () => null,
  };
}

function mount(responses = [{ status: 200, body: "{}" }], products?: Record<string, CatalogueItem>) {
  const http = scriptedHttp(responses);
  return createHarness({
    http,
    adapters: [fakeAdapter(PUSHY, pushCatalogue), fakeAdapter(PULLY, pullCatalogue), fakeAdapter(BARE)],
    catalogue: hostCatalogue(products),
  });
}

/** The catalogue jobs queued so far. */
const jobs = (h: Harness) =>
  h.enqueued.filter((job) => job.name === "marketplace.catalogue").map((job) => job.payload as unknown as CatalogueJobPayload);

const FIRST = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };

/** Run the newest queued catalogue job. */
async function runLatest(h: Harness, attempt = LAST) {
  const payload = jobs(h).at(-1);
  if (!payload) throw new Error("no catalogue job queued");
  return h.engine.runCatalogue(payload, attempt);
}

async function stateOf(h: Harness, provider = PUSHY, productId = "p-1") {
  const found = await h.engine.catalogueState({ clientId: TENANT, productIds: [productId], providers: [provider] });
  return found[0];
}

describe("catalogue publishing, push", () => {
  it("publishes: PUBLISHING at once, PUBLISHED with the marketplace's id and the store's price once the job runs", async () => {
    const h = mount();
    await h.connect(PUSHY);

    const asked = await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });

    expect(asked).toMatchObject({ kind: "queued", publication: { status: "PUBLISHING", priceCents: null } });
    expect(h.http.requests).toEqual([]);
    expect(await runLatest(h)).toEqual({ kind: "done", action: "publish" });
    expect(await stateOf(h)).toMatchObject({ status: "PUBLISHED", externalId: "px-p-1", sentPriceCents: 2500 });
    expect(JSON.parse(h.http.requests[0]?.body ?? "{}")).toEqual({ name: "Burger", price: 2500, category: "Burgers" });
  });

  it("maps the SKU the marketplace's orders will carry to the product, and keeps the map after a withdraw", async () => {
    const h = mount();
    await h.connect(PUSHY);
    h.memory.tables.marketplaceMenuLink.rows.push({
      id: "link-old",
      clientId: TENANT,
      provider: PUSHY,
      externalSku: "p-1",
      externalName: "Burger",
      menuItemId: null,
      lastSeenAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h);
    await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h);

    const links = await h.engine.menuLinks({ clientId: TENANT, provider: PUSHY });
    expect(links.map((link) => [link.externalSku, link.menuItemId])).toEqual([["p-1", "p-1"]]);
  });

  it("an iFood order for a published product arrives mapped", async () => {
    const http = scriptedHttp((request) =>
      request.url.endsWith("/oauth/token")
        ? { status: 200, body: JSON.stringify({ accessToken: "tok" }) }
        : { status: 200, body: JSON.stringify([{ id: "cat-1", name: "Burgers" }]) },
    );
    const h = createHarness({ http, catalogue: hostCatalogue({ "SKU-1": BURGER }) });
    await h.connect("IFOOD");
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "SKU-1" });
    await runLatest(h);

    const unmapped = await h.engine.menuLinks({ clientId: TENANT, provider: "IFOOD", unmappedOnly: true });
    expect(unmapped).toEqual([]);
    expect(await h.engine.menuLinks({ clientId: TENANT, provider: "IFOOD" })).toMatchObject([
      { externalSku: "SKU-1", externalName: "Burger", menuItemId: "SKU-1" },
    ]);
  });

  it("sends the marketplace's own price when the store set one, and keeps it on the row", async () => {
    const h = mount();
    await h.connect(PUSHY);

    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1", priceCents: 2900 });
    await runLatest(h);

    expect(await stateOf(h)).toMatchObject({ status: "PUBLISHED", priceCents: 2900, sentPriceCents: 2900 });
    expect(JSON.parse(h.http.requests[0]?.body ?? "{}").price).toBe(2900);
  });

  it("goes back to the store's price when the price is cleared with null", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1", priceCents: 2900 });
    await runLatest(h);

    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1", priceCents: null });
    await runLatest(h);

    expect(await stateOf(h)).toMatchObject({ priceCents: null, sentPriceCents: 2500 });
  });

  it("a refusal is FAILED with the marketplace's reason, and publishing again retries it", async () => {
    const h = mount([
      { status: 422, body: "category is paused" },
      { status: 200, body: "{}" },
    ]);
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });

    expect(await runLatest(h, FIRST)).toMatchObject({ kind: "failed", reason: "REFUSED" });
    expect(await stateOf(h)).toMatchObject({
      status: "FAILED",
      failedAction: "PUBLISH",
      failureCode: "REFUSED",
      failureReason: "category is paused",
    });

    expect(await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" })).toMatchObject({
      kind: "queued",
      publication: { status: "PUBLISHING", failureReason: null },
    });
    await runLatest(h);
    expect(await stateOf(h)).toMatchObject({ status: "PUBLISHED", failedAction: null });
  });

  it("retries a 5xx through the queue until the last attempt, which ends FAILED", async () => {
    const h = mount([{ status: 503, body: "busy" }]);
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });

    await expect(runLatest(h, FIRST)).rejects.toBeInstanceOf(CatalogueRetryError);
    expect((await stateOf(h))?.status).toBe("PUBLISHING");
    expect(await runLatest(h, LAST)).toMatchObject({ kind: "failed" });
    // No words of the marketplace to show, and no internal message either: only the code.
    expect(await stateOf(h)).toMatchObject({ status: "FAILED", failureCode: "UNAVAILABLE", failureReason: null });
  });

  it("a double tap keeps the same ask: same instant, same dedupe key, one call", async () => {
    const h = mount();
    await h.connect(PUSHY);

    const first = await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    h.clock.at = new Date(h.clock.at.getTime() + 1000);
    const second = await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });

    expect(first.kind === "queued" && second.kind === "queued").toBe(true);
    const keys = h.enqueued.filter((job) => job.name === "marketplace.catalogue").map((job) => job.dedupeKey);
    expect(new Set(keys).size).toBe(1);
    await runLatest(h);
    expect(await runLatest(h)).toMatchObject({ kind: "skipped" });
    expect(h.http.requests).toHaveLength(1);
  });

  it("a new price set while the publish is in flight is sent by a run of its own", async () => {
    const mounted: { harness?: Harness } = {};
    const prices: number[] = [];
    const http = scriptedHttp(async (request) => {
      prices.push(JSON.parse(request.body ?? "{}").price);
      // The store changes the price while the first call is on its way.
      if (prices.length === 1) {
        await mounted.harness?.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1", priceCents: 3100 });
      }
      return { status: 200, body: "{}" };
    });
    const h = createHarness({ http, adapters: [fakeAdapter(PUSHY, pushCatalogue)], catalogue: hostCatalogue() });
    mounted.harness = h;
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    const firstJob = jobs(h).at(-1)!;
    h.clock.at = new Date(h.clock.at.getTime() + 1000);

    await h.engine.runCatalogue(firstJob, LAST);

    expect((await stateOf(h))?.status).toBe("PUBLISHING");
    const keys = h.enqueued.filter((job) => job.name === "marketplace.catalogue").map((job) => job.dedupeKey);
    expect(new Set(keys).size).toBe(2);
    await runLatest(h);
    expect(prices).toEqual([2500, 3100]);
    expect(await stateOf(h)).toMatchObject({ status: "PUBLISHED", priceCents: 3100, sentPriceCents: 3100 });
  });

  it("withdraws: WITHDRAWING at once, WITHDRAWN once the marketplace took it, by the id the publish answered", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h);

    expect(await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" })).toMatchObject({
      kind: "queued",
      publication: { status: "WITHDRAWING" },
    });
    expect(await runLatest(h)).toEqual({ kind: "done", action: "withdraw" });
    expect(await stateOf(h)).toMatchObject({ status: "WITHDRAWN" });
    expect(h.http.requests.at(-1)?.url).toBe("https://pushy.test/items/px-p-1/off");
  });

  it("a withdraw while publishing wins: the publish run calls nobody, the withdraw ends WITHDRAWN", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    const publishJob = jobs(h).at(-1)!;
    h.clock.at = new Date(h.clock.at.getTime() + 1000);

    await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" });

    expect(await h.engine.runCatalogue(publishJob, LAST)).toMatchObject({ kind: "skipped" });
    await runLatest(h);
    expect(await stateOf(h)).toMatchObject({ status: "WITHDRAWN" });
    expect(h.http.requests.map((request) => request.method)).toEqual(["PATCH"]);
  });

  it("a publish that lands after the store withdrew is withdrawn again", async () => {
    const mounted: { harness?: Harness } = {};
    const http = scriptedHttp(async (request) => {
      // The store switches it off while the publish call is in flight.
      if (request.method === "PUT") await mounted.harness?.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
      return { status: 200, body: "{}" };
    });
    const h = createHarness({ http, adapters: [fakeAdapter(PUSHY, pushCatalogue)], catalogue: hostCatalogue() });
    mounted.harness = h;
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    const publishJob = jobs(h).at(-1)!;

    await h.engine.runCatalogue(publishJob, LAST);

    expect(await stateOf(h)).toMatchObject({ status: "WITHDRAWING", externalId: "px-p-1" });
    expect(jobs(h).at(-1)?.action).toBe("withdraw");
    await runLatest(h);
    expect(await stateOf(h)).toMatchObject({ status: "WITHDRAWN" });
  });

  it("a withdraw that lands after the store switched the product back on is followed by a publish again", async () => {
    const mounted: { harness?: Harness } = {};
    const http = scriptedHttp(async (request) => {
      // The store switches it back on while the withdraw call is in flight.
      if (request.method === "PATCH") await mounted.harness?.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
      return { status: 200, body: "{}" };
    });
    const h = createHarness({ http, adapters: [fakeAdapter(PUSHY, pushCatalogue)], catalogue: hostCatalogue() });
    mounted.harness = h;
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h);
    h.clock.at = new Date(h.clock.at.getTime() + 1000);
    await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    const withdrawJob = jobs(h).at(-1)!;
    h.clock.at = new Date(h.clock.at.getTime() + 1000);

    await h.engine.runCatalogue(withdrawJob, LAST);
    // The withdraw landed after the store's new ask: it stamps nothing, and the publish is owed again.
    expect((await stateOf(h))?.status).toBe("PUBLISHING");
    h.clock.at = new Date(h.clock.at.getTime() + 1000);
    await runLatest(h);

    expect(h.http.requests.map((request) => request.method)).toEqual(["PUT", "PATCH", "PUT"]);
    expect((await stateOf(h))?.status).toBe("PUBLISHED");
  });

  it("a withdraw after a failed publish is still sent: its answer may have been lost after it landed", async () => {
    const h = mount([
      { status: 503, body: "busy" },
      { status: 200, body: "{}" },
    ]);
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h, LAST);
    expect((await stateOf(h))?.status).toBe("FAILED");

    expect(await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" })).toMatchObject({
      kind: "queued",
      publication: { status: "WITHDRAWING" },
    });
    await runLatest(h);

    expect(h.http.requests.map((request) => request.method)).toEqual(["PUT", "PATCH"]);
    expect((await stateOf(h))?.status).toBe("WITHDRAWN");
    expect(await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-2" })).toEqual({
      kind: "unchanged",
      publication: null,
    });
  });

  it("a withdraw for a connection archived since is out at once, with nobody to tell", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h);
    h.patchIntegration({ archivedAt: new Date("2026-11-11T11:00:00.000Z") });

    expect(await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" })).toMatchObject({
      kind: "unchanged",
      publication: { status: "WITHDRAWN" },
    });
    expect(h.http.requests).toHaveLength(1);
  });

  it("a withdraw already queued when the connection was archived ends WITHDRAWN, not FAILED", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await runLatest(h);
    await h.engine.withdraw({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    h.patchIntegration({ archivedAt: new Date("2026-11-11T11:00:00.000Z") });

    await runLatest(h);

    expect(await stateOf(h)).toMatchObject({ status: "WITHDRAWN", failureCode: null });
    expect(h.http.requests).toHaveLength(1);
  });

  it("refuses before stamping anything: no catalogue, not connected, unknown product, a bad price", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.connect(BARE);
    const ask = (input: Partial<{ provider: string; productId: string; priceCents: number }>) =>
      h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1", ...input });

    expect(await ask({ provider: BARE })).toEqual({ kind: "refused", code: "UNSUPPORTED" });
    expect(await ask({ provider: PULLY })).toEqual({ kind: "refused", code: "NOT_CONNECTED" });
    expect(await ask({ productId: "gone" })).toEqual({ kind: "refused", code: "UNKNOWN_PRODUCT" });
    expect(await ask({ priceCents: 0 })).toEqual({ kind: "refused", code: "INVALID_PRICE" });
    expect(await ask({ priceCents: 12.5 })).toEqual({ kind: "refused", code: "INVALID_PRICE" });
    expect(h.memory.tables.marketplaceCataloguePublication.rows).toEqual([]);
    expect(h.engine.catalogueMode(BARE)).toBeNull();
    expect(h.engine.catalogueMode(PUSHY)).toBe("push");
  });

  it("FAILS a publish whose product disappeared before the job ran", async () => {
    const products: Record<string, CatalogueItem> = { "p-1": BURGER };
    const h = mount(undefined, products);
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    delete products["p-1"];

    await runLatest(h);

    expect(await stateOf(h)).toMatchObject({ status: "FAILED", failedAction: "PUBLISH", failureCode: "PRODUCT_GONE", failureReason: null });
    expect(h.http.requests).toEqual([]);
  });

  it("reads a whole product page in one call: every marketplace it was ever switched on for", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.connect(PULLY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    await h.engine.publish({ clientId: TENANT, provider: PULLY, productId: "p-1" });

    const listed = await h.engine.catalogueState({ clientId: TENANT, productIds: ["p-1", "p-9"] });

    expect(listed.map((row) => `${row.provider}:${row.status}`).sort()).toEqual(["PULLY:PUBLISHING", "PUSHY:PUBLISHING"]);
  });
});

describe("catalogue publishing, pull", () => {
  it("publishes by telling the marketplace the menu changed; the menu the host serves lists the item at its price", async () => {
    const h = mount([{ status: 204, body: "" }], { "p-1": BURGER, "p-2": { ...BURGER, name: "Fries", priceCents: 900 } });
    await h.connect(PULLY);
    await h.engine.publish({ clientId: TENANT, provider: PULLY, productId: "p-1", priceCents: 2700 });
    await h.engine.publish({ clientId: TENANT, provider: PULLY, productId: "p-2" });

    const options = { menuName: "Menu", currency: "XTS" };
    const document = await h.engine.catalogueDocument({ clientId: TENANT, provider: PULLY, options });
    expect(document).toEqual({
      kind: "document",
      document: {
        merchant: "merchant-PULLY",
        currency: "XTS",
        items: [
          { code: "p-1", price: 2700 },
          { code: "p-2", price: 900 },
        ],
      },
    });

    await runLatest(h);
    expect(h.http.requests.map((request) => request.url)).toEqual(["https://pully.test/changed"]);
    expect(await stateOf(h, PULLY, "p-2")).toMatchObject({ status: "PUBLISHED", sentPriceCents: 900 });

    await h.engine.withdraw({ clientId: TENANT, provider: PULLY, productId: "p-1" });
    const after = await h.engine.catalogueDocument({ clientId: TENANT, provider: PULLY, options });
    expect(after).toMatchObject({ document: { items: [{ code: "p-2" }] } });
  });

  it("keeps a published item in the menu, at the price last sent, when a re-publish fails; a failed first publish is not listed", async () => {
    const h = mount(
      [
        { status: 204, body: "" },
        { status: 404, body: "no merchant" },
      ],
      { "p-1": BURGER, "p-2": { ...BURGER, name: "Fries", priceCents: 900 } },
    );
    await h.connect(PULLY);
    const options = { menuName: "Menu", currency: "XTS" };
    await h.engine.publish({ clientId: TENANT, provider: PULLY, productId: "p-1" });
    await runLatest(h);

    await h.engine.publish({ clientId: TENANT, provider: PULLY, productId: "p-1", priceCents: 2800 });
    await runLatest(h);
    await h.engine.publish({ clientId: TENANT, provider: PULLY, productId: "p-2" });
    await runLatest(h);

    expect((await stateOf(h, PULLY, "p-1"))?.status).toBe("FAILED");
    expect((await stateOf(h, PULLY, "p-2"))?.status).toBe("FAILED");
    expect(await h.engine.catalogueDocument({ clientId: TENANT, provider: PULLY, options })).toMatchObject({
      document: { items: [{ code: "p-1", price: 2500 }] },
    });
  });

  it("serves no document for a push marketplace or one not connected", async () => {
    const h = mount();
    const options = { menuName: "Menu", currency: "XTS" };
    expect(await h.engine.catalogueDocument({ clientId: TENANT, provider: PUSHY, options })).toEqual({
      kind: "refused",
      code: "UNSUPPORTED",
    });
    expect(await h.engine.catalogueDocument({ clientId: TENANT, provider: PULLY, options })).toEqual({
      kind: "refused",
      code: "NOT_CONNECTED",
    });
  });
});

describe("the sweep, for the catalogue", () => {
  it("re-queues a row still owed after the job's retry span, and FAILS one a day old", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    const asked = jobs(h).length;

    h.clock.at = new Date(h.clock.at.getTime() + 11 * 60_000);
    expect((await h.engine.sweepOutbound()).catalogueRequeued).toBe(1);
    expect(jobs(h).length).toBe(asked + 1);

    h.clock.at = new Date(h.clock.at.getTime() + 24 * 60 * 60_000);
    expect((await h.engine.sweepOutbound()).catalogueRequeued).toBe(0);
    expect(await stateOf(h)).toMatchObject({ status: "FAILED", failedAction: "PUBLISH", failureCode: "TIMEOUT", failureReason: null });
  });
});

describe("failure codes", () => {
  it("ends a publish whose credentials will not open as CREDENTIALS, with no internal message on the row", async () => {
    const h = mount();
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });
    h.patchIntegration({ credentials: "garbage" });

    await runLatest(h);

    expect(await stateOf(h)).toMatchObject({ status: "FAILED", failureCode: "CREDENTIALS", failureReason: null });
    expect(h.logged.some((line) => line.level === "error" && line.message.includes("do not open"))).toBe(true);
  });

  it("ends an adapter that throws on the last attempt as INTERNAL", async () => {
    const throwing: PushCatalogue = { ...pushCatalogue, publishItem: async () => Promise.reject(new Error("boom at line 3")) };
    const h = createHarness({ http: scriptedHttp([]), adapters: [fakeAdapter(PUSHY, throwing)], catalogue: hostCatalogue() });
    await h.connect(PUSHY);
    await h.engine.publish({ clientId: TENANT, provider: PUSHY, productId: "p-1" });

    expect(await runLatest(h, LAST)).toMatchObject({ kind: "failed", reason: "INTERNAL" });
    expect(await stateOf(h)).toMatchObject({ failureCode: "INTERNAL", failureReason: null });
  });
});

describe("the photo, on the row", () => {
  it("uploads a photo once, reuses it on the next publish, and keeps a warning on the row", async () => {
    let uploadStatus = 200;
    const http = scriptedHttp((request) => {
      if (request.url.endsWith("/oauth/token")) return { status: 200, body: JSON.stringify({ accessToken: "tok" }) };
      if (request.url.endsWith("/image/upload")) return { status: uploadStatus, body: JSON.stringify({ imagePath: "m/x.png" }) };
      if (request.method === "GET") return { status: 200, body: JSON.stringify([{ id: "cat-1", name: "Burgers" }]) };
      return { status: 200, body: "{}" };
    });
    const products: Record<string, CatalogueItem> = { "p-1": BURGER };
    const h = createHarness({
      http,
      catalogue: { ...hostCatalogue(products), image: async () => ({ contentType: "image/png", base64: "AAAA" }) },
    });
    await h.connect("IFOOD");
    const uploads = () => http.requests.filter((request) => request.url.endsWith("/image/upload")).length;

    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });
    await runLatest(h);
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1", priceCents: 2700 });
    await runLatest(h);
    expect(uploads()).toBe(1);

    products["p-1"] = { ...BURGER, imageUrl: "https://img.test/huge.png" };
    uploadStatus = 413;
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1", priceCents: 2800 });
    await runLatest(h);

    expect(uploads()).toBe(2);
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "PUBLISHED", warningCode: "IMAGE_TOO_LARGE", sentPriceCents: 2800 });
  });
});

describe("a category created once", () => {
  it("two products switched on at once into a new iFood category create it once, and both land in it", async () => {
    const categories: { id: string; name: string }[] = [];
    const http = scriptedHttp((request) => {
      if (request.url.endsWith("/oauth/token")) return { status: 200, body: JSON.stringify({ accessToken: "tok" }) };
      if (request.method === "GET") return { status: 200, body: JSON.stringify(categories) };
      if (request.url.endsWith("/categories")) {
        categories.push({ id: `cat-${categories.length + 1}`, name: "Drinks" });
        return { status: 201, body: JSON.stringify(categories.at(-1)) };
      }
      return { status: 200, body: "{}" };
    });
    const drink: CatalogueItem = { ...BURGER, categoryName: "Drinks", imageUrl: null };
    const h = createHarness({ http, catalogue: hostCatalogue({ "p-1": drink, "p-2": drink }) });
    await h.connect("IFOOD");
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-2" });
    const [first, second] = jobs(h);

    const runs = await Promise.allSettled([h.engine.runCatalogue(first!, FIRST), h.engine.runCatalogue(second!, FIRST)]);
    // The one that found the category being created is retried by the queue, and then reuses it.
    const retried = runs.flatMap((run, index) => (run.status === "rejected" ? [[first, second][index]!] : []));
    expect(retried).toHaveLength(1);
    expect(runs.find((run) => run.status === "rejected")).toMatchObject({ reason: expect.any(CatalogueRetryError) });
    await h.engine.runCatalogue(retried[0]!, FIRST);

    expect(http.requests.filter((request) => request.method === "POST" && request.url.endsWith("/categories"))).toHaveLength(1);
    const puts = http.requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => JSON.parse(request.body ?? "{}").item.categoryId)).toEqual(["cat-1", "cat-1"]);
    const rows = await h.engine.catalogueState({ clientId: TENANT, productIds: ["p-1", "p-2"] });
    expect(rows.map((row) => row.status)).toEqual(["PUBLISHED", "PUBLISHED"]);
  });
});

describe("a category creation that did not finish", () => {
  /** iFood with an empty category list that grows with each create; `failFirstCreate` times the first one out. */
  function ifoodCategories(options: { failFirstCreate?: boolean } = {}) {
    const categories: { id: string; name: string }[] = [];
    const creates: string[] = [];
    const http = scriptedHttp((request) => {
      if (request.url.endsWith("/oauth/token")) return { status: 200, body: JSON.stringify({ accessToken: "tok" }) };
      if (request.method === "GET") return { status: 200, body: JSON.stringify(categories) };
      if (request.url.endsWith("/categories")) {
        creates.push(request.url);
        if (options.failFirstCreate && creates.length === 1) throw new Error("ETIMEDOUT");
        categories.push({ id: `cat-${categories.length + 1}`, name: "Drinks" });
        return { status: 201, body: JSON.stringify(categories.at(-1)) };
      }
      return { status: 200, body: "{}" };
    });
    return { http, categories, creates };
  }
  const drink: CatalogueItem = { ...BURGER, categoryName: "Drinks", imageUrl: null };

  it("a create that timed out releases its claim: the next attempt creates the category once and publishes", async () => {
    const fake = ifoodCategories({ failFirstCreate: true });
    const h = createHarness({ http: fake.http, catalogue: hostCatalogue({ "p-1": drink }) });
    await h.connect("IFOOD");
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });

    await expect(runLatest(h, FIRST)).rejects.toBeInstanceOf(CatalogueRetryError);
    h.clock.at = new Date(h.clock.at.getTime() + 10_000);
    await runLatest(h, { attempt: 2, maxAttempts: 3 });

    expect(fake.categories).toEqual([{ id: "cat-1", name: "Drinks" }]);
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "PUBLISHED" });
  });

  it("a claim whose holder died is taken over within the waiting publish's retries", async () => {
    const fake = ifoodCategories();
    const h = createHarness({ http: fake.http, catalogue: hostCatalogue({ "p-1": drink }) });
    await h.connect("IFOOD");
    h.memory.tables.marketplaceCatalogueCategory.rows.push({
      id: "claim-1",
      clientId: TENANT,
      provider: "IFOOD",
      name: "Drinks",
      externalId: null,
      claimedAt: h.clock.at,
    });
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });

    await expect(runLatest(h, FIRST)).rejects.toBeInstanceOf(CatalogueRetryError);
    h.clock.at = new Date(h.clock.at.getTime() + 10_000);
    await expect(runLatest(h, { attempt: 2, maxAttempts: 3 })).rejects.toBeInstanceOf(CatalogueRetryError);
    h.clock.at = new Date(h.clock.at.getTime() + 20_000);
    await runLatest(h, LAST);

    expect(fake.creates).toHaveLength(1);
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "PUBLISHED" });
  });

  it("a publish that only waited for another's category is left PUBLISHING for the sweep, never FAILED", async () => {
    const fake = ifoodCategories();
    const h = createHarness({ http: fake.http, catalogue: hostCatalogue({ "p-1": drink }) });
    await h.connect("IFOOD");
    h.memory.tables.marketplaceCatalogueCategory.rows.push({
      id: "claim-1",
      clientId: TENANT,
      provider: "IFOOD",
      name: "Drinks",
      externalId: null,
      claimedAt: h.clock.at,
    });
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });

    expect(await runLatest(h, LAST)).toMatchObject({ kind: "skipped" });
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "PUBLISHING", failureCode: null });

    // The holder finished meanwhile; the sweep re-queues the row and it publishes into that category.
    h.memory.tables.marketplaceCatalogueCategory.rows[0]!.externalId = "cat-9";
    h.clock.at = new Date(h.clock.at.getTime() + 11 * 60_000);
    expect((await h.engine.sweepOutbound()).catalogueRequeued).toBe(1);
    await runLatest(h, FIRST);
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "PUBLISHED" });
    expect(fake.creates).toEqual([]);
  });
});

describe("a stored category the store deleted on the marketplace", () => {
  function ifoodWith(listed: { id: string; name: string }[]) {
    return scriptedHttp((request) => {
      if (request.url.endsWith("/oauth/token")) return { status: 200, body: JSON.stringify({ accessToken: "tok" }) };
      if (request.method === "GET") return { status: 200, body: JSON.stringify(listed) };
      if (request.method === "PUT") {
        const used = JSON.parse(request.body ?? "{}").item.categoryId as string;
        return listed.some((category) => category.id === used) ? { status: 200, body: "{}" } : { status: 404, body: "category" };
      }
      return { status: 201, body: JSON.stringify({ id: "cat-created", name: "Burgers" }) };
    });
  }
  function storedCategory(h: Harness, externalId: string) {
    h.memory.tables.marketplaceCatalogueCategory.rows.push({
      id: "stored-1",
      clientId: TENANT,
      provider: "IFOOD",
      name: "Burgers",
      externalId,
      claimedAt: null,
    });
  }

  it("forgets the stale id, finds the category again and publishes into it", async () => {
    const http = ifoodWith([{ id: "cat-new", name: "Burgers" }]);
    const h = createHarness({ http, catalogue: hostCatalogue({ "p-1": { ...BURGER, imageUrl: null } }) });
    await h.connect("IFOOD");
    storedCategory(h, "cat-gone");
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });

    await runLatest(h);

    const puts = http.requests.filter((request) => request.method === "PUT");
    expect(puts.map((request) => JSON.parse(request.body ?? "{}").item.categoryId)).toEqual(["cat-gone", "cat-new"]);
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "PUBLISHED" });
    expect(h.memory.tables.marketplaceCatalogueCategory.rows[0]).toMatchObject({ externalId: "cat-new" });
  });

  it("keeps the stored id and the refusal when the category is still there", async () => {
    const http = scriptedHttp((request) => {
      if (request.url.endsWith("/oauth/token")) return { status: 200, body: JSON.stringify({ accessToken: "tok" }) };
      if (request.method === "GET") return { status: 200, body: JSON.stringify([{ id: "cat-1", name: "Burgers" }]) };
      return { status: 400, body: "price missing" };
    });
    const h = createHarness({ http, catalogue: hostCatalogue({ "p-1": { ...BURGER, imageUrl: null } }) });
    await h.connect("IFOOD");
    storedCategory(h, "cat-1");
    await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" });

    await runLatest(h);

    expect(http.requests.filter((request) => request.method === "PUT")).toHaveLength(1);
    expect(await stateOf(h, "IFOOD")).toMatchObject({ status: "FAILED", failureCode: "REFUSED", failureReason: "price missing" });
    expect(h.memory.tables.marketplaceCatalogueCategory.rows[0]).toMatchObject({ externalId: "cat-1" });
  });
});

describe("a host with no catalogue port", () => {
  it("answers UNSUPPORTED and states no mode, though iFood's adapter is push", async () => {
    const h = createHarness({ http: scriptedHttp([{ status: 200, body: "{}" }]) });
    await h.connect("IFOOD");

    expect(await h.engine.publish({ clientId: TENANT, provider: "IFOOD", productId: "p-1" })).toEqual({
      kind: "refused",
      code: "UNSUPPORTED",
    });
    expect(h.engine.catalogueMode("IFOOD")).toBeNull();
    expect(createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }).catalogue?.mode).toBe("push");
  });
});
