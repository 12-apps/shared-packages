import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WireRoute } from "@12-apps/wiring";

import type { MarketplaceCredentials } from "../../core/adapter";
import { TENANT, createHarness, ifoodPlaced, scriptedHttp, type Harness } from "../../__tests__/harness";
import { createApiMarketplace } from "..";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../en-US";

/**
 * Who a delivery belongs to (FUT-5613 review, B1 and B3): the app's single
 * address routes by merchant id, so one merchant is one live connection, and
 * an ambiguous or unknown merchant is refused; a linked store's per-store
 * address verifies with the app's key, which defaults to its client secret,
 * and never accepts an unsigned delivery.
 */

const APP: MarketplaceCredentials = { clientId: "app-id", clientSecret: "app-secret", webhookSecret: "app-hook" };
const B = "tenant-B";

function ifoodHttp(merchants: () => { id: string; name: string }[] = () => [{ id: "merchant-IFOOD", name: "Loja" }]) {
  return scriptedHttp((request) => {
    if (request.url.includes("/oauth/userCode")) {
      const code = { userCode: "U", authorizationCodeVerifier: "v", verificationUrl: "https://p/x", expiresIn: 600 };
      return { status: 200, body: JSON.stringify(code) };
    }
    if (request.url.includes("/oauth/token")) {
      return { status: 200, body: JSON.stringify({ accessToken: "a", expiresIn: 21600, refreshToken: "r" }) };
    }
    return { status: 200, body: JSON.stringify(merchants()) };
  });
}

async function link(h: Harness, clientId: string) {
  await h.engine.startLink({ clientId, provider: "IFOOD" });
  return h.engine.finishLink({ clientId, provider: "IFOOD", authorizationCode: "C", actorId: null, enabled: true });
}

function routeOf(h: Harness, path: string): WireRoute<unknown> {
  const api = createApiMarketplace({
    engine: h.engine,
    copy: MARKETPLACE_SERVER_COPY_EN_US,
    tenantBySlug: async (slug) => (slug === "loja" ? TENANT : null),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return api.routes.find((route) => route.path === path) as WireRoute<unknown>;
}

function post(h: Harness, path: string, params: Record<string, string>, payload: unknown, key: string | null) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = key === null ? {} : { "x-ifood-signature": createHmac("sha256", key).update(raw, "utf8").digest("hex") };
  return routeOf(h, path).handle({
    actor: undefined,
    params,
    query: {},
    request: new Request("https://host.test/hook", { method: "POST", body: raw, headers }),
  });
}

const appPost = (h: Harness, payload: unknown, key: string | null = APP.webhookSecret) =>
  post(h, "/webhooks/marketplace/:provider", { provider: "IFOOD" }, payload, key);

describe("the app's address routes a delivery to exactly one store", () => {
  it("refuses another store's ordinary save of a merchant a linked store holds, so the linked store keeps its orders", async () => {
    const h = createHarness({ http: ifoodHttp(), appCredentials: () => APP });
    await h.engine.saveIntegration({
      clientId: B,
      provider: "IFOOD",
      externalMerchantId: "m-B",
      enabled: true,
      credentials: { clientId: "b", clientSecret: "b", webhookSecret: "b-hook" },
    });
    expect(await link(h, TENANT)).toMatchObject({ kind: "linked", integration: { externalMerchantId: "merchant-IFOOD" } });

    await expect(h.engine.saveIntegration({ clientId: B, provider: "IFOOD", externalMerchantId: "merchant-IFOOD" })).rejects.toMatchObject({
      code: "MERCHANT_TAKEN",
      path: ["externalMerchantId"],
    });

    expect(await h.engine.tenantFor("IFOOD", "merchant-IFOOD")).toBe(TENANT);
    expect(await appPost(h, ifoodPlaced("ext-1"))).toEqual({ status: 200, body: { received: true, outcome: "ingested" } });
    expect(h.created.map((order) => order.clientId)).toEqual([TENANT]);
  });

  it("refuses a linked store's ordinary save of another linked store's merchant: the order never becomes its pedido", async () => {
    let merchants: { id: string; name: string }[] = [];
    const h = createHarness({ http: ifoodHttp(() => merchants), appCredentials: () => APP });
    expect(await link(h, B)).toMatchObject({ integration: { externalMerchantId: null } });
    merchants = [{ id: "merchant-IFOOD", name: "Loja" }];
    expect(await link(h, TENANT)).toMatchObject({ integration: { externalMerchantId: "merchant-IFOOD" } });

    await expect(h.engine.saveIntegration({ clientId: B, provider: "IFOOD", externalMerchantId: "merchant-IFOOD" })).rejects.toMatchObject({
      code: "MERCHANT_TAKEN",
    });

    expect((await appPost(h, ifoodPlaced("ext-1"))).status).toBe(200);
    expect(h.created.map((order) => order.clientId)).toEqual([TENANT]);
  });

  it("refuses a delivery whose merchant two live connections hold (a host's rows from before the index), never picking one", async () => {
    const h = createHarness({ http: ifoodHttp(), appCredentials: () => APP });
    await link(h, TENANT);
    const holder = h.memory.tables.marketplaceIntegration.rows[0]!;
    // A second live row with the same merchant, as a host's older data may hold it.
    h.memory.tables.marketplaceIntegration.rows.push({ ...holder, id: "legacy", clientId: B });

    expect(await h.engine.tenantFor("IFOOD", "merchant-IFOOD")).toBeNull();
    expect((await appPost(h, ifoodPlaced("ext-1"))).status).toBe(401);
    expect(h.created).toEqual([]);
  });
});
