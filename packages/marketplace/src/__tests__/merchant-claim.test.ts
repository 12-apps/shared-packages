import { describe, expect, it, vi } from "vitest";

import type { WireRoute } from "@12-apps/wiring";

import { createApiMarketplace, type MarketplaceActor } from "../server";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../server/en-US";
import { TENANT, createHarness, scriptedHttp, type Harness } from "./harness";

/**
 * One marketplace store, one live connection (FUT-5613 review, B1): every
 * write path refuses a merchant id another store's live connection holds, at
 * the merchant field, and the race between the check and the write is closed
 * by the unique index, its violation read as the same refusal.
 */

const APP = { clientId: "app-id", clientSecret: "app-secret", webhookSecret: "app-hook" };
const B = "tenant-B";
const OWN = { clientId: "b", clientSecret: "b", webhookSecret: "b-hook" };

function ifoodHttp(merchants: () => string[]) {
  return scriptedHttp((request) => {
    if (request.url.includes("/oauth/userCode")) {
      const code = { userCode: "U", authorizationCodeVerifier: "v", verificationUrl: "https://p/x", expiresIn: 600 };
      return { status: 200, body: JSON.stringify(code) };
    }
    if (request.url.includes("/oauth/token")) {
      return { status: 200, body: JSON.stringify({ accessToken: "a", expiresIn: 21600, refreshToken: "r" }) };
    }
    return { status: 200, body: JSON.stringify(merchants().map((id) => ({ id, name: id }))) };
  });
}

async function link(h: Harness, clientId: string) {
  await h.engine.startLink({ clientId, provider: "IFOOD" });
  return h.engine.finishLink({ clientId, provider: "IFOOD", authorizationCode: "C", actorId: null, enabled: true });
}

/** A store A (TENANT) linked to merchant-IFOOD. */
async function holder(merchants: () => string[] = () => ["merchant-IFOOD"]) {
  const h = createHarness({ http: ifoodHttp(merchants), appCredentials: () => APP });
  expect(await link(h, TENANT)).toMatchObject({ integration: { externalMerchantId: "merchant-IFOOD" } });
  return h;
}

const rowOf = (h: Harness, clientId: string) => h.memory.tables.marketplaceIntegration.rows.find((row) => row.clientId === clientId);

/** The next read of who holds a merchant answers nobody: the other writer's commit lands right after the check. */
function hideHolderOnce(h: Harness): void {
  const table = h.memory.tables.marketplaceIntegration;
  const findMany = table.findMany.bind(table);
  const hides = [true];
  vi.spyOn(table, "findMany").mockImplementation(async (args: unknown) => {
    const where = (args as { where?: { externalMerchantId?: unknown } } | undefined)?.where;
    return typeof where?.externalMerchantId === "string" && hides.shift() ? [] : findMany(args);
  });
}

describe("the bulk upsert and its MCP tool", () => {
  it("refuse a merchant another store's live connection holds, at the merchant field, and write nothing", async () => {
    const h = await holder();

    const result = await h.engine.upsertIntegrations({
      clientId: B,
      actorId: null,
      rows: [{ provider: "IFOOD", externalMerchantId: "merchant-IFOOD", credentials: OWN }],
    });

    expect(result).toEqual({ kind: "refused", problems: [{ path: ["integrations", 0, "externalMerchantId"], code: "MERCHANT_TAKEN" }] });
    expect(rowOf(h, B)).toBeUndefined();
  });

  it("refuse reviving an archived connection whose merchant another store now holds", async () => {
    const h = createHarness({ http: ifoodHttp(() => ["merchant-IFOOD"]), appCredentials: () => APP });
    await h.engine.saveIntegration({ clientId: B, provider: "IFOOD", externalMerchantId: "merchant-IFOOD", credentials: OWN });
    await h.engine.upsertIntegrations({ clientId: B, actorId: null, rows: [{ operation: "archive", provider: "IFOOD" }] });
    await link(h, TENANT);

    const result = await h.engine.upsertIntegrations({ clientId: B, actorId: null, rows: [{ operation: "unarchive", provider: "IFOOD" }] });

    expect(result).toEqual({ kind: "refused", problems: [{ path: ["integrations", 0, "provider"], code: "MERCHANT_TAKEN" }] });
    expect(rowOf(h, B)?.archivedAt).not.toBeNull();
  });

  it("answer the route's refusal 422 with the merchant problem worded, as the MCP tool proxies it", async () => {
    const h = await holder();
    const api = createApiMarketplace({
      engine: h.engine,
      copy: MARKETPLACE_SERVER_COPY_EN_US,
      tenantBySlug: async () => B,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    const put = api.routes.find((route) => route.method === "PUT" && route.path === "/admin/:tenantSlug/marketplace") as WireRoute<MarketplaceActor>;

    const answer = await put.handle({
      actor: { clientId: B, userId: "user-1" },
      params: { tenantSlug: "b" },
      query: {},
      body: { integrations: [{ provider: "IFOOD", externalMerchantId: "merchant-IFOOD" }] },
    });

    expect(answer.status).toBe(422);
    expect((answer.body as { problems: unknown[] }).problems).toEqual([
      {
        path: ["integrations", 0, "externalMerchantId"],
        code: "MERCHANT_TAKEN",
        message: MARKETPLACE_SERVER_COPY_EN_US.link?.problems.MERCHANT_TAKEN,
      },
    ]);
  });

  it("read the unique index's violation of a race they lost as the same refusal", async () => {
    const h = await holder();
    hideHolderOnce(h);

    const result = await h.engine.upsertIntegrations({ clientId: B, actorId: null, rows: [{ provider: "IFOOD", externalMerchantId: "merchant-IFOOD" }] });

    expect(result).toEqual({ kind: "refused", problems: [{ path: ["integrations", 0, "externalMerchantId"], code: "MERCHANT_TAKEN" }] });
    expect(rowOf(h, B)).toBeUndefined();
  });
});

describe("the ordinary save", () => {
  it("keeps a store's own merchant, and lets another store take a merchant once its holder archived", async () => {
    const h = await holder();
    await expect(h.engine.saveIntegration({ clientId: TENANT, provider: "IFOOD", externalMerchantId: "merchant-IFOOD" })).resolves.toMatchObject({
      externalMerchantId: "merchant-IFOOD",
    });
    await h.engine.upsertIntegrations({ clientId: TENANT, actorId: null, rows: [{ operation: "archive", provider: "IFOOD" }] });

    await expect(h.engine.saveIntegration({ clientId: B, provider: "IFOOD", externalMerchantId: "merchant-IFOOD" })).resolves.toMatchObject({
      externalMerchantId: "merchant-IFOOD",
    });
  });

  it("reads the unique index's violation of a race it lost as MERCHANT_TAKEN", async () => {
    const h = await holder();
    hideHolderOnce(h);

    await expect(h.engine.saveIntegration({ clientId: B, provider: "IFOOD", externalMerchantId: "merchant-IFOOD" })).rejects.toMatchObject({
      code: "MERCHANT_TAKEN",
      path: ["externalMerchantId"],
    });
  });
});

describe("linking races another store for one merchant", () => {
  it("the merchant choice that lost the race is refused MERCHANT_TAKEN, and changes nothing", async () => {
    let merchants = ["merchant-IFOOD", "m-2"];
    const h = createHarness({ http: ifoodHttp(() => merchants), appCredentials: () => APP });
    expect(await link(h, B)).toMatchObject({ integration: { externalMerchantId: null } });
    merchants = ["merchant-IFOOD"];
    await link(h, TENANT);
    merchants = ["merchant-IFOOD", "m-2"];
    hideHolderOnce(h);

    const result = await h.engine.selectLinkedMerchant({ clientId: B, provider: "IFOOD", merchantId: "merchant-IFOOD" });

    expect(result).toMatchObject({ kind: "refused", code: "MERCHANT_TAKEN" });
    expect(rowOf(h, B)?.externalMerchantId).toBeNull();
    expect(await h.engine.tenantFor("IFOOD", "merchant-IFOOD")).toBe(TENANT);
  });

  it("a link that lost the race still saves its tokens, with no merchant chosen", async () => {
    const h = await holder();
    hideHolderOnce(h);

    const result = await link(h, B);

    expect(result).toMatchObject({ kind: "linked", integration: { authMode: "LINKED", externalMerchantId: null } });
    expect(rowOf(h, B)?.credentials).not.toBe("");
    expect(await h.engine.tenantFor("IFOOD", "merchant-IFOOD")).toBe(TENANT);
  });
});
