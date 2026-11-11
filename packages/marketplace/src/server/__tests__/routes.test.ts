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
    actor: { clientId: TENANT, userId: "user-1" },
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
  const BASE = "/admin/:tenantSlug/marketplace";
  type Problem = { path: (string | number)[]; code: string; message: string };
  const problemsOf = (answer: WireResponse) => (answer.body as { problems: Problem[] }).problems;

  it("declare their permission: connecting and mapping take manage, the queue takes decide", () => {
    const h = createHarness();
    const table = api(h)
      .routes.filter((candidate) => candidate.kind !== "webhook")
      .map((candidate) => `${candidate.method} ${candidate.path} -> ${candidate.permission}`);
    expect(table).toEqual([
      `GET ${BASE} -> marketplace:manage`,
      `PUT ${BASE} -> marketplace:manage`,
      `GET ${BASE}/menu-links -> marketplace:manage`,
      `PUT ${BASE}/menu-links -> marketplace:manage`,
      `GET ${BASE}/acceptances -> marketplace:decide`,
      `POST ${BASE}/acceptances -> marketplace:decide`,
    ]);
  });

  it("upserts many connections, never answers a secret, and carries each marketplace's reasons", async () => {
    const h = createHarness();
    const saved = await call(h, "PUT", BASE, {
      body: {
        integrations: [{ provider: "IFOOD", enabled: true, credentials: { clientId: "a", clientSecret: "very-secret" } }],
      },
    });

    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain("very-secret");
    const listed = (await call(h, "GET", BASE, { query: { ids: "IFOOD" } })).body as {
      data: { connected: boolean; reasons: { code: string }[]; capabilities: { apiCancel: boolean } }[];
    };
    expect(listed.data[0]).toMatchObject({ connected: true, capabilities: { apiCancel: true } });
    expect(listed.data[0]?.reasons.map((reason) => reason.code)).toContain("503");
  });

  it("archives and unarchives through the same tool, audited, and lists archived ones only when asked", async () => {
    const h = createHarness();
    await h.connect();

    const archived = await call(h, "PUT", BASE, {
      body: { integrations: [{ operation: "archive", provider: "IFOOD", reason: "closed for renovation" }] },
    });

    expect(archived.status).toBe(200);
    expect((await call(h, "GET", BASE)).body).toEqual({ data: [] });
    const all = (await call(h, "GET", BASE, { query: { includeArchived: "true" } })).body as { data: { archivedAt: string }[] };
    expect(all.data[0]?.archivedAt).toBe(h.clock.at.toISOString());
    expect(h.audited).toEqual([
      expect.objectContaining({ action: "marketplace.integration.archive", actorId: "user-1", reason: "closed for renovation" }),
    ]);
  });

  it("refuses an unknown key, a repeated provider and an empty change with every path, saving nothing", async () => {
    const h = createHarness();
    const unknownKey = await call(h, "PUT", BASE, { body: { integrations: [{ provider: "IFOOD", enabled: true, extra: 1 }] } });
    const repeated = await call(h, "PUT", BASE, {
      body: { integrations: [{ provider: "IFOOD", enabled: true }, { provider: "IFOOD", autoAccept: true }] },
    });
    const engineChecks = await call(h, "PUT", BASE, {
      body: { integrations: [{ provider: "NOBODY", enabled: true }, { provider: "IFOOD" }] },
    });
    const archiveNothing = await call(h, "PUT", BASE, { body: { integrations: [{ operation: "archive", provider: "IFOOD" }] } });

    expect(unknownKey.status).toBe(422);
    expect(problemsOf(repeated)).toEqual([expect.objectContaining({ path: ["integrations", 1, "provider"] })]);
    expect(engineChecks).toMatchObject({ status: 422, body: { error: MARKETPLACE_SERVER_COPY_EN_US.nothingSaved } });
    expect(problemsOf(engineChecks).map((problem) => [problem.path, problem.code])).toEqual([
      [["integrations", 0, "provider"], "UNKNOWN_PROVIDER"],
      [["integrations", 1], "NOTHING_TO_UPDATE"],
    ]);
    expect(problemsOf(archiveNothing).map((problem) => [problem.path, problem.code])).toEqual([
      [["integrations", 0, "provider"], "NOT_FOUND"],
    ]);
    expect(await h.engine.integrations(TENANT, { includeArchived: true })).toEqual([]);
  });

  it("validateOnly saves no connection", async () => {
    const h = createHarness();
    const answer = await call(h, "PUT", BASE, { body: { validateOnly: true, integrations: [{ provider: "IFOOD", enabled: true }] } });

    expect(answer).toEqual({ status: 200, body: { data: { validateOnly: true, integrations: [] } } });
    expect(await h.engine.integrations(TENANT)).toEqual([]);
  });

  it("maps many SKUs all-or-nothing, reads the attention list as text booleans, and names a foreign catalog id", async () => {
    const h = createHarness();
    await h.connect();
    await post(h, ifoodPlaced("ext-1"));
    const unmapped = await call(h, "GET", `${BASE}/menu-links`, { query: { unmapped: "true" } });
    const foreign = await call(h, "PUT", `${BASE}/menu-links`, {
      body: {
        links: [
          { provider: "IFOOD", externalSku: "SKU-1", menuItemId: "menu-1" },
          { provider: "IFOOD", externalSku: "SKU-2", menuItemId: "foreign" },
        ],
      },
    });
    const stillUnmapped = await call(h, "GET", `${BASE}/menu-links`, { query: { unmapped: "true" } });
    const mapped = await call(h, "PUT", `${BASE}/menu-links`, {
      body: { links: [{ provider: "IFOOD", externalSku: "SKU-1", menuItemId: "menu-1" }, { provider: "IFOOD", externalSku: "SKU-2", menuItemId: null }] },
    });
    const after = await call(h, "GET", `${BASE}/menu-links`, { query: { unmapped: "false" } });

    expect((unmapped.body as { data: { externalSku: string }[] }).data.map((link) => link.externalSku)).toEqual(["SKU-1"]);
    expect(foreign.status).toBe(422);
    expect(problemsOf(foreign)).toEqual([
      { path: ["links", 1, "menuItemId"], code: "CATALOG_ITEM_NOT_FOUND", message: MARKETPLACE_SERVER_COPY_EN_US.problems.CATALOG_ITEM_NOT_FOUND },
    ]);
    // All-or-nothing: the valid first row was not written either.
    expect((stillUnmapped.body as { data: unknown[] }).data).toHaveLength(1);
    expect(mapped.status).toBe(200);
    expect((after.body as { data: unknown[] }).data).toHaveLength(2);
  });

  it("re-running the same SKU upsert is idempotent", async () => {
    const h = createHarness();
    const body = { links: [{ provider: "IFOOD", externalSku: "SKU-9", menuItemId: "menu-1" }] };
    await call(h, "PUT", `${BASE}/menu-links`, { body });
    await call(h, "PUT", `${BASE}/menu-links`, { body });
    expect(h.memory.tables.marketplaceMenuLink.rows).toHaveLength(1);
  });

  it("decides many: 200 with the stamps; 422 naming a bad reason's path; 409 when not pending; nothing written on a refusal", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));
    await post(h, ifoodPlaced("ext-2"));
    const path = `${BASE}/acceptances`;

    const invalid = await call(h, "POST", path, {
      body: { decisions: [{ orderId: "order-1", decision: "REJECT", reasonCode: "999" }, { orderId: "order-2", decision: "ACCEPT" }] },
    });
    const decided = await call(h, "POST", path, {
      body: { decisions: [{ orderId: "order-1", decision: "REJECT", reasonCode: "503" }, { orderId: "order-2", decision: "ACCEPT" }] },
    });
    const stale = await call(h, "POST", path, { body: { decisions: [{ orderId: "order-1", decision: "ACCEPT" }] } });
    const codeOnAccept = await call(h, "POST", path, { body: { decisions: [{ orderId: "order-2", decision: "ACCEPT", reasonCode: "503" }] } });

    expect(invalid.status).toBe(422);
    expect(problemsOf(invalid)).toEqual([expect.objectContaining({ path: ["decisions", 0, "reasonCode"], code: "INVALID_REASON" })]);
    expect(decided).toEqual({
      status: 200,
      body: {
        data: {
          validateOnly: false,
          decisions: [
            { orderId: "order-1", status: "REJECTED", cancellation: "PENDING", reasonCode: "503", offendingSkus: [] },
            { orderId: "order-2", status: "ACCEPTED", cancellation: null, reasonCode: null, offendingSkus: [] },
          ],
        },
      },
    });
    expect(stale).toMatchObject({ status: 409, body: { code: "MARKETPLACE_ORDER_NOT_PENDING" } });
    expect(problemsOf(stale)[0]).toMatchObject({ code: "ALREADY_DECIDED", status: "REJECTED" });
    expect(codeOnAccept.status).toBe(422);
  });

  it("[M2] answers the host's coded refusal as a 409 with its code and details, then accepts once admitted", async () => {
    const h = createHarness({
      admit: async (request) =>
        request.admission.admitStockPastZero
          ? { admitted: true }
          : { admitted: false, code: "MARKETPLACE_STOCK_ASK", message: "Short.", details: { short: ["Tuna"] } },
    });
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));
    const path = `${BASE}/acceptances`;

    const asked = await call(h, "POST", path, { body: { decisions: [{ orderId: "order-1", decision: "ACCEPT" }] } });
    const admitted = await call(h, "POST", path, {
      body: { decisions: [{ orderId: "order-1", decision: "ACCEPT", admission: { admitStockPastZero: true } }] },
    });

    expect(asked).toMatchObject({ status: 409, body: { code: "MARKETPLACE_STOCK_ASK", error: "Short.", details: { short: ["Tuna"] } } });
    expect(h.acceptance("order-1")?.status).toBe("ACCEPTED");
    expect(admitted.status).toBe(200);
  });

  it("lists the queue, narrowed by ids, with its deadlines as instants", async () => {
    const h = createHarness();
    await h.connect("IFOOD", { webhookSecret: SECRET });
    await post(h, ifoodPlaced("ext-1"));
    await post(h, ifoodPlaced("ext-2"));

    const answer = await call(h, "GET", `${BASE}/acceptances`, { query: { ids: "order-2" } });

    const data = (answer.body as { data: { orderId: string; acknowledgeBy: string }[] }).data;
    expect(data.map((row) => row.orderId)).toEqual(["order-2"]);
    expect(data[0]?.acknowledgeBy).toBe(new Date(h.clock.at.getTime() + 300_000).toISOString());
  });
});
