import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WireResponse, WireRoute } from "@12-apps/wiring";

import type { MarketplaceHttpResponse } from "../../core/adapter";
import { TENANT, createHarness, ifoodPlaced, scriptedHttp, type Harness } from "../../__tests__/harness";
import { MARKETPLACE_MANAGE, createApiMarketplace, type MarketplaceActor } from "..";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../en-US";
import { MARKETPLACE_SERVER_COPY_PT_BR } from "../pt-BR";

/**
 * The linking routes and the app's single webhook address (FUT-5613), over a
 * real engine with a fake iFood answering its documented shapes.
 */

const APP = { clientId: "app-id", clientSecret: "app-secret", webhookSecret: "app-hook" };
const LINK = "/admin/:tenantSlug/marketplace/link";

function ifoodHttp(token?: MarketplaceHttpResponse) {
  return scriptedHttp((request) => {
    if (request.url.includes("/oauth/userCode")) {
      return {
        status: 200,
        body: JSON.stringify({
          userCode: "HJLX-LPSQ",
          authorizationCodeVerifier: "verifier-1",
          verificationUrl: "https://portal.ifood.com.br/apps/code",
          verificationUrlComplete: "https://portal.ifood.com.br/apps/code?c=HJLX-LPSQ",
          expiresIn: 600,
        }),
      };
    }
    if (request.url.includes("/oauth/token")) {
      return token ?? { status: 200, body: JSON.stringify({ accessToken: "access-1", expiresIn: 21600, refreshToken: "refresh-1" }) };
    }
    return { status: 200, body: JSON.stringify([{ id: "merchant-IFOOD", name: "Loja" }]) };
  });
}

function api(h: Harness) {
  return createApiMarketplace({
    engine: h.engine,
    copy: MARKETPLACE_SERVER_COPY_EN_US,
    tenantBySlug: async () => TENANT,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
}

function route(h: Harness, method: string, path: string) {
  const found = api(h).routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found;
}

function call(h: Harness, method: string, path: string, parts: { query?: Record<string, string>; body?: unknown } = {}) {
  const target = route(h, method, path) as WireRoute<MarketplaceActor>;
  return target.handle({
    actor: { clientId: TENANT, userId: "user-1" },
    params: { tenantSlug: "the-store" },
    query: parts.query ?? {},
    body: parts.body,
  });
}

const data = (response: WireResponse) => (response.body as { data: Record<string, unknown> }).data;

describe("the linking routes", () => {
  it("are all gated by marketplace:manage", () => {
    const h = createHarness();
    const routes = api(h).routes.filter((candidate) => candidate.path.startsWith(LINK));
    expect(routes.map((candidate) => `${candidate.method} ${candidate.path.slice(LINK.length) || "/"}`)).toEqual([
      "GET /",
      "GET /merchants",
      "POST /start",
      "POST /finish",
      "PUT /merchant",
    ]);
    expect(new Set(routes.map((candidate) => candidate.permission))).toEqual(new Set([MARKETPLACE_MANAGE]));
  });

  it("say linking is unavailable with no app configured, in the host's words", async () => {
    const h = createHarness({ http: ifoodHttp() });

    expect(data(await call(h, "GET", LINK, { query: { provider: "IFOOD" } }))).toEqual({ available: false, pending: null });
    const refused = await call(h, "POST", `${LINK}/start`, { body: { provider: "IFOOD" } });
    expect(refused).toEqual({
      status: 409,
      body: { error: MARKETPLACE_SERVER_COPY_EN_US.link.problems.UNAVAILABLE, code: "UNAVAILABLE" },
    });
  });

  it("start answers the code and the portal link, and never the verifier", async () => {
    const h = createHarness({ http: ifoodHttp(), appCredentials: () => APP });

    const started = await call(h, "POST", `${LINK}/start`, { body: { provider: "IFOOD" } });

    expect(started.status).toBe(200);
    expect(data(started)).toEqual({
      userCode: "HJLX-LPSQ",
      verificationUrl: "https://portal.ifood.com.br/apps/code",
      verificationUrlComplete: "https://portal.ifood.com.br/apps/code?c=HJLX-LPSQ",
      expiresAt: new Date(h.clock.at.getTime() + 600_000).toISOString(),
    });
    expect(JSON.stringify(started)).not.toContain("verifier-1");
    expect((data(await call(h, "GET", LINK, { query: { provider: "IFOOD" } })).pending as { userCode: string }).userCode).toBe("HJLX-LPSQ");
  });

  it("finish links the store, with no secret in the answer", async () => {
    const h = createHarness({ http: ifoodHttp(), appCredentials: () => APP });
    await call(h, "POST", `${LINK}/start`, { body: { provider: "IFOOD" } });

    const finished = await call(h, "POST", `${LINK}/finish`, { body: { provider: "IFOOD", authorizationCode: " AUTH-1 ", enabled: true } });

    expect(finished.status).toBe(200);
    expect(data(finished).integration).toMatchObject({ authMode: "LINKED", externalMerchantId: "merchant-IFOOD", enabled: true });
    expect(JSON.stringify(finished)).not.toMatch(/refresh-1|access-1|app-secret|verifier-1/);
  });

  it("finish answers a refused code 422 with iFood's own words beside the host's sentence", async () => {
    const refused = { status: 401, body: JSON.stringify({ error: { code: "Unauthorized", message: "Bad credentials" } }) };
    const h = createHarness({ http: ifoodHttp(refused), appCredentials: () => APP });
    await call(h, "POST", `${LINK}/start`, { body: { provider: "IFOOD" } });

    const answer = await call(h, "POST", `${LINK}/finish`, { body: { provider: "IFOOD", authorizationCode: "WRONG" } });

    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ code: "CODE_REFUSED", marketplaceStatus: 401, error: MARKETPLACE_SERVER_COPY_EN_US.link.problems.CODE_REFUSED });
  });

  it("refuses a body that does not parse, and an unknown marketplace", async () => {
    const h = createHarness({ appCredentials: () => APP });
    expect((await call(h, "POST", `${LINK}/finish`, { body: { provider: "IFOOD" } })).status).toBe(422);
    expect((await call(h, "POST", `${LINK}/start`, { body: { provider: "NOPE" } })).body).toMatchObject({ code: "UNKNOWN_PROVIDER" });
  });

  it("lists the merchants of a linked store and takes its choice", async () => {
    const h = createHarness({ http: ifoodHttp(), appCredentials: () => APP });
    await call(h, "POST", `${LINK}/start`, { body: { provider: "IFOOD" } });
    await call(h, "POST", `${LINK}/finish`, { body: { provider: "IFOOD", authorizationCode: "AUTH-1" } });

    expect(data(await call(h, "GET", `${LINK}/merchants`, { query: { provider: "IFOOD" } }))).toEqual([
      { id: "merchant-IFOOD", name: "Loja", corporateName: null },
    ]);
    const chosen = await call(h, "PUT", `${LINK}/merchant`, { body: { provider: "IFOOD", merchantId: "merchant-IFOOD" } });
    expect(chosen.status).toBe(200);
    expect((await call(h, "PUT", `${LINK}/merchant`, { body: { provider: "IFOOD", merchantId: "other" } })).status).toBe(422);
  });

  it("both packs word every refusal", () => {
    for (const pack of [MARKETPLACE_SERVER_COPY_EN_US, MARKETPLACE_SERVER_COPY_PT_BR]) {
      expect(Object.keys(pack.link.problems).sort()).toEqual(Object.keys(MARKETPLACE_SERVER_COPY_EN_US.link.problems).sort());
      expect(Object.values(pack.link.problems).every((sentence) => sentence.length > 0)).toBe(true);
    }
  });
});

describe("the app's webhook address", () => {
  async function linkedHarness() {
    const h = createHarness({ http: ifoodHttp(), appCredentials: () => APP });
    await call(h, "POST", `${LINK}/start`, { body: { provider: "IFOOD" } });
    await call(h, "POST", `${LINK}/finish`, { body: { provider: "IFOOD", authorizationCode: "AUTH-1", enabled: true } });
    return h;
  }

  function post(h: Harness, payload: unknown, key: string | null = APP.webhookSecret) {
    const raw = JSON.stringify(payload);
    const webhook = route(h, "POST", "/webhooks/marketplace/:provider") as WireRoute<unknown>;
    const headers: Record<string, string> = key === null ? {} : { "x-ifood-signature": createHmac("sha256", key).update(raw, "utf8").digest("hex") };
    return webhook.handle({
      actor: undefined,
      params: { provider: "IFOOD" },
      query: {},
      request: new Request("https://host.test/hook", { method: "POST", body: raw, headers }),
    });
  }

  it("is an unguarded webhook route", async () => {
    const webhook = route(await linkedHarness(), "POST", "/webhooks/marketplace/:provider");
    expect(webhook.kind).toBe("webhook");
    expect(webhook.permission).toBeUndefined();
  });

  it("finds the store by the merchant the delivery names and ingests a delivery the app signed", async () => {
    const h = await linkedHarness();

    const answer = await post(h, ifoodPlaced("ext-1"));

    expect(answer).toEqual({ status: 200, body: { received: true, outcome: "ingested" } });
    expect(h.created.map((order) => order.clientId)).toEqual([TENANT]);
  });

  it("refuses an unsigned delivery, one signed with another key, and an unknown merchant, alike", async () => {
    const h = await linkedHarness();

    expect((await post(h, ifoodPlaced("ext-1"), null)).status).toBe(401);
    expect((await post(h, ifoodPlaced("ext-1"), "guess")).status).toBe(401);
    expect((await post(h, { ...ifoodPlaced("ext-2"), merchantId: "stranger" })).status).toBe(401);
    expect(h.created).toEqual([]);
  });
});
