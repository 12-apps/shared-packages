import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WireResponse, WireRoute } from "@12-apps/wiring";

import { TENANT, createHarness, ifoodEvent, ifoodPlaced, type Harness } from "../../__tests__/harness";
import { createApiMarketplace, type MarketplaceActor } from "..";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../en-US";

/**
 * The route descriptors over a real engine (in-memory db, scripted HTTP):
 * the webhook end to end with signatures, and the authenticated routes'
 * validation, envelopes and refusals.
 */

const SECRET = "shh";

function api(h: Harness) {
  return createApiMarketplace({
    engine: h.engine,
    copy: MARKETPLACE_SERVER_COPY_EN_US,
    tenantBySlug: async (slug) => (slug === "the-store" ? TENANT : null),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
}

function route(h: Harness, method: string, path: string) {
  const found = api(h).routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found;
}

async function call(
  h: Harness,
  method: string,
  path: string,
  parts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
): Promise<WireResponse> {
  const target = route(h, method, path) as WireRoute<MarketplaceActor>;
  return target.handle({
    actor: { clientId: TENANT },
    params: { tenantSlug: "the-store", ...parts.params },
    query: parts.query ?? {},
    body: parts.body,
  });
}

async function post(h: Harness, payload: unknown, options: { slug?: string; provider?: string; sign?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
  const webhook = route(h, "POST", "/webhooks/marketplace/:tenantSlug/:provider") as WireRoute<unknown>;
  return webhook.handle({
    actor: undefined,
    params: { tenantSlug: options.slug ?? "the-store", provider: options.provider ?? "IFOOD" },
    query: {},
    request: new Request("https://host.test/hook", {
      method: "POST",
      body: raw,
      headers: options.sign === false ? {} : { "x-ifood-signature": signature },
    }),
  });
}

describe("the webhook", () => {
  it("is declared a webhook route, unguarded by any permission", () => {
    const h = createHarness();
    const webhook = route(h, "POST", "/webhooks/marketplace/:tenantSlug/:provider");
    expect(webhook.kind).toBe("webhook");
    expect(webhook.permission).toBeUndefined();
  });

  it("ingests a signed delivery and answers 200 with the outcome", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });

    const answer = await post(h, ifoodPlaced("ext-1"));

    expect(answer).toEqual({ status: 200, body: { received: true, outcome: "ingested" } });
    expect(h.created).toHaveLength(1);
  });

  it("refuses a bad signature, an unknown slug and a store with no connection, all as the same 401", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });

    const unsigned = await post(h, ifoodPlaced("ext-1"), { sign: false });
    const stranger = await post(h, ifoodPlaced("ext-1"), { slug: "nobody" });
    const bare = createHarness();
    const unconnected = await post(bare, ifoodPlaced("ext-1"));

    for (const answer of [unsigned, stranger, unconnected]) {
      expect(answer).toEqual({ status: 401, body: { error: "unauthorized" } });
    }
    expect(h.created).toHaveLength(0);
  });

  it("answers 404 for a provider no adapter is registered for", async () => {
    const h = createHarness();
    expect((await post(h, {}, { provider: "NOBODY" })).status).toBe(404);
  });

  it("answers a duplicate and an event it does not act on with 200, so the marketplace stops redelivering", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));

    expect((await post(h, ifoodPlaced("ext-1"))).body).toEqual({ received: true, outcome: "duplicate" });
    expect((await post(h, ifoodEvent("ext-1", "DSP"))).body).toEqual({ received: true, outcome: "ignored" });
    expect((await post(h, { code: "PLC" })).body).toEqual({ received: true, ignored: "unrecognized_payload" });
  });

  it("[J5] takes CANCELLATION_REQUEST_FAILED as understood, with one HTTP call to nobody", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));
    await h.engine.decide({ clientId: TENANT, orderId: "order-1", decision: "REJECT", reasonCode: "503" });

    const answer = await post(h, ifoodEvent("ext-1", "CANCELLATION_REQUEST_FAILED"));

    expect(answer.body).toEqual({ received: true, outcome: "cancellationFailed" });
    expect(h.acceptance("order-1")?.cancellationStatus).toBe("FAILED");
    expect(h.http.requests).toHaveLength(0);
  });
});

describe("the authenticated routes", () => {
  it("declare their permission: connecting and mapping take manage, the queue takes decide", () => {
    const h = createHarness();
    const table = api(h)
      .routes.filter((candidate) => candidate.kind !== "webhook")
      .map((candidate) => `${candidate.method} ${candidate.path} -> ${candidate.permission}`);
    expect(table).toEqual([
      "GET /admin/:tenantSlug/marketplace -> marketplace:manage",
      "PUT /admin/:tenantSlug/marketplace -> marketplace:manage",
      "DELETE /admin/:tenantSlug/marketplace -> marketplace:manage",
      "GET /admin/:tenantSlug/marketplace/menu-links -> marketplace:manage",
      "PUT /admin/:tenantSlug/marketplace/menu-links -> marketplace:manage",
      "GET /admin/:tenantSlug/marketplace/acceptances -> marketplace:decide",
      "POST /admin/:tenantSlug/marketplace/acceptances/:orderId -> marketplace:decide",
    ]);
  });

  it("saves a connection, never answers its secret, and carries the marketplace's reasons", async () => {
    const h = createHarness();
    const saved = await call(h, "PUT", "/admin/:tenantSlug/marketplace", {
      body: { provider: "IFOOD", enabled: true, credentials: { clientId: "a", clientSecret: "very-secret" } },
    });

    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain("very-secret");
    const listed = (await call(h, "GET", "/admin/:tenantSlug/marketplace")).body as {
      data: { connected: boolean; reasons: { code: string }[]; capabilities: { apiCancel: boolean } }[];
    };
    expect(listed.data[0]).toMatchObject({ connected: true, capabilities: { apiCancel: true } });
    expect(listed.data[0]?.reasons.map((reason) => reason.code)).toContain("503");
  });

  it("refuses an unknown key, an unknown provider and an empty save with 422", async () => {
    const h = createHarness();
    const unknownKey = await call(h, "PUT", "/admin/:tenantSlug/marketplace", { body: { provider: "IFOOD", enabled: true, extra: 1 } });
    const unknownProvider = await call(h, "PUT", "/admin/:tenantSlug/marketplace", { body: { provider: "NOBODY", enabled: true } });
    const empty = await call(h, "PUT", "/admin/:tenantSlug/marketplace", { body: { provider: "IFOOD" } });

    expect(unknownKey).toMatchObject({ status: 422, body: { error: MARKETPLACE_SERVER_COPY_EN_US.invalidInput } });
    expect(unknownProvider).toMatchObject({ status: 422, body: { error: MARKETPLACE_SERVER_COPY_EN_US.unknownProvider } });
    expect(empty).toMatchObject({ status: 422, body: { error: MARKETPLACE_SERVER_COPY_EN_US.nothingToUpdate } });
  });

  it("maps a SKU, reads the attention list as text booleans, and 404s a foreign catalog id", async () => {
    const h = createHarness();
    await h.connect();
    await post(h, ifoodPlaced("ext-1"));

    const unmapped = await call(h, "GET", "/admin/:tenantSlug/marketplace/menu-links", { query: { unmapped: "true" } });
    const foreign = await call(h, "PUT", "/admin/:tenantSlug/marketplace/menu-links", {
      body: { provider: "IFOOD", externalSku: "SKU-1", menuItemId: "foreign" },
    });
    const mapped = await call(h, "PUT", "/admin/:tenantSlug/marketplace/menu-links", {
      body: { provider: "IFOOD", externalSku: "SKU-1", menuItemId: "menu-1" },
    });
    const everything = await call(h, "GET", "/admin/:tenantSlug/marketplace/menu-links", { query: { unmapped: "false" } });
    const after = await call(h, "GET", "/admin/:tenantSlug/marketplace/menu-links", { query: { unmapped: "true" } });

    expect((unmapped.body as { data: { externalSku: string }[] }).data.map((link) => link.externalSku)).toEqual(["SKU-1"]);
    expect((after.body as { data: unknown[] }).data).toHaveLength(0);
    expect(foreign).toMatchObject({ status: 404, body: { error: MARKETPLACE_SERVER_COPY_EN_US.catalogItemNotFound } });
    expect(mapped.status).toBe(200);
    expect((everything.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it("decides: 200 with the stamps, 409 when stale, 422 with the valid codes when the reason is not the marketplace's", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));
    await post(h, ifoodPlaced("ext-2"));
    const path = "/admin/:tenantSlug/marketplace/acceptances/:orderId";

    const invalid = await call(h, "POST", path, { params: { orderId: "order-1" }, body: { decision: "REJECT", reasonCode: "999" } });
    const refused = await call(h, "POST", path, { params: { orderId: "order-1" }, body: { decision: "REJECT", reasonCode: "503" } });
    const stale = await call(h, "POST", path, { params: { orderId: "order-1" }, body: { decision: "ACCEPT" } });
    const codeOnAccept = await call(h, "POST", path, { params: { orderId: "order-2" }, body: { decision: "ACCEPT", reasonCode: "503" } });

    expect(invalid).toMatchObject({ status: 422, body: { error: MARKETPLACE_SERVER_COPY_EN_US.invalidReason } });
    expect((invalid.body as { validCodes: string[] }).validCodes).toContain("503");
    expect(refused).toEqual({
      status: 200,
      body: { data: { id: "order-1", ackStatus: "REJECTED", cancellation: "PENDING", reasonCode: "503" } },
    });
    expect(stale).toMatchObject({ status: 409, body: { error: MARKETPLACE_SERVER_COPY_EN_US.orderNoLongerPending } });
    expect(codeOnAccept.status).toBe(422);
    expect(h.acceptance("order-2")?.status).toBe("AWAITING");
  });

  it("lists the queue with its deadlines as instants", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));

    const answer = await call(h, "GET", "/admin/:tenantSlug/marketplace/acceptances");

    expect((answer.body as { data: { acknowledgeBy: string }[] }).data[0]?.acknowledgeBy).toBe(
      new Date(h.clock.at.getTime() + 300_000).toISOString(),
    );
  });

  it("forgets a connection by its provider", async () => {
    const h = createHarness();
    await h.connect();
    expect(await call(h, "DELETE", "/admin/:tenantSlug/marketplace", { query: { provider: "IFOOD" } })).toEqual({
      status: 200,
      body: { data: { ok: true } },
    });
    expect(await h.engine.integrations(TENANT)).toEqual([]);
  });
});
