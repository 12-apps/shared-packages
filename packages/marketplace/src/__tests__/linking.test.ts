import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../core/adapter";
import type { MarketplaceAppCredentialsPort } from "../core/linking-port";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/**
 * Linking a store through the software's own iFood app (FUT-5613), end to end
 * over the engine: start keeps the verifier sealed, finish stores the store's
 * refresh token on a LINKED connection, outbound calls refresh through it, and
 * the store's own credentials keep working with no app configured. The HTTP
 * client is a fake answering iFood's documented shapes; nothing leaves the
 * process.
 */

const APP = { clientId: "app-id", clientSecret: "app-secret", webhookSecret: "app-hook" };
const appCredentials: MarketplaceAppCredentialsPort = (provider) => (provider === "IFOOD" ? APP : null);

const USER_CODE = {
  userCode: "HJLX-LPSQ",
  authorizationCodeVerifier: "verifier-1",
  verificationUrl: "https://portal.ifood.com.br/apps/code",
  verificationUrlComplete: "https://portal.ifood.com.br/apps/code?c=HJLX-LPSQ",
  expiresIn: 600,
};

type Answer = MarketplaceHttpResponse | ((request: MarketplaceHttpRequest) => MarketplaceHttpResponse);

/** Answer iFood by path: the user code, the token grants, the merchant list, an order call. */
function ifood(overrides: Partial<Record<"userCode" | "token" | "merchants" | "order", Answer>> = {}) {
  const json = (body: unknown): MarketplaceHttpResponse => ({ status: 200, body: JSON.stringify(body) });
  const answers: Record<string, Answer> = {
    userCode: json(USER_CODE),
    token: json({ accessToken: "access-1", type: "bearer", expiresIn: 21600, refreshToken: "refresh-1" }),
    merchants: json([{ id: "merchant-IFOOD", name: "Loja", corporateName: null }]),
    order: { status: 202, body: "" },
    ...overrides,
  };
  return scriptedHttp((request) => {
    const kind = request.url.includes("/oauth/userCode")
      ? "userCode"
      : request.url.includes("/oauth/token")
        ? "token"
        : request.url.includes("/merchants")
          ? "merchants"
          : "order";
    const answer = answers[kind]!;
    return typeof answer === "function" ? answer(request) : answer;
  });
}

const form = (request: MarketplaceHttpRequest | undefined) => Object.fromEntries(new URLSearchParams(request?.body ?? ""));
const opened = (h: Harness, sealed: unknown) => JSON.parse(Buffer.from(String(sealed).slice("sealed:".length), "base64").toString());

async function linked(h: Harness) {
  const started = await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
  if (started.kind !== "started") throw new Error(started.kind);
  const finished = await h.engine.finishLink({ clientId: TENANT, provider: "IFOOD", authorizationCode: "AUTH-1", actorId: "user-1", enabled: true });
  if (finished.kind !== "linked") throw new Error(finished.kind);
  return finished;
}

describe("linking availability", () => {
  it("is unavailable with no app configured, and the store's own credentials connect unchanged", async () => {
    const http = ifood();
    const h = createHarness({ http });

    expect(await h.engine.linkState({ clientId: TENANT, provider: "IFOOD" })).toEqual({ available: false, pending: null });
    expect(await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" })).toMatchObject({ kind: "refused", code: "UNAVAILABLE" });
    await h.connect();
    const [view] = await h.engine.integrations(TENANT);
    expect(view).toMatchObject({ authMode: "CREDENTIALS", connected: true });
    expect(http.requests).toEqual([]);
  });

  it("is unavailable for a marketplace the app has no credentials on, or a host without the link table", async () => {
    const h = createHarness({ http: ifood(), appCredentials: () => null });
    expect((await h.engine.linkState({ clientId: TENANT, provider: "IFOOD" })).available).toBe(false);

    const bare = createHarness({ http: ifood(), appCredentials });
    delete (bare.memory.db as { marketplaceLinkAttempt?: unknown }).marketplaceLinkAttempt;
    expect((await bare.engine.linkState({ clientId: TENANT, provider: "IFOOD" })).available).toBe(false);
  });
});

describe("starting a link", () => {
  it("asks iFood for a code with the app's client id and keeps the verifier sealed, never in the answer", async () => {
    const http = ifood();
    const h = createHarness({ http, appCredentials });

    const started = await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });

    expect(started).toEqual({
      kind: "started",
      pending: {
        userCode: "HJLX-LPSQ",
        verificationUrl: "https://portal.ifood.com.br/apps/code",
        verificationUrlComplete: "https://portal.ifood.com.br/apps/code?c=HJLX-LPSQ",
        expiresAt: new Date(h.clock.at.getTime() + 600_000),
      },
    });
    expect(JSON.stringify(started)).not.toContain("verifier-1");
    expect(form(http.requests[0])).toEqual({ clientId: "app-id" });
    const [attempt] = h.memory.tables.marketplaceLinkAttempt.rows;
    expect(attempt?.verifier).not.toBe("verifier-1");
    expect(Buffer.from(String(attempt?.verifier).slice("sealed:".length), "base64").toString()).toBe("verifier-1");
    expect((await h.engine.linkState({ clientId: TENANT, provider: "IFOOD" })).pending?.userCode).toBe("HJLX-LPSQ");
  });

  it("replaces an earlier attempt, and no longer shows one whose ten minutes are over", async () => {
    const h = createHarness({ http: ifood(), appCredentials });
    await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
    await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
    expect(h.memory.tables.marketplaceLinkAttempt.rows).toHaveLength(1);

    h.setNow(new Date(h.clock.at.getTime() + 601_000));
    expect((await h.engine.linkState({ clientId: TENANT, provider: "IFOOD" })).pending).toBeNull();
  });
});

describe("finishing a link", () => {
  it("exchanges the pasted code with the kept verifier and stores a LINKED, verified connection", async () => {
    const http = ifood();
    const h = createHarness({ http, appCredentials });

    const finished = await linked(h);

    expect(form(http.requests[1])).toEqual({
      grantType: "authorization_code",
      clientId: "app-id",
      clientSecret: "app-secret",
      authorizationCode: "AUTH-1",
      authorizationCodeVerifier: "verifier-1",
    });
    expect(http.requests[2]?.headers.Authorization).toBe("Bearer access-1");
    expect(finished.merchants).toEqual([{ id: "merchant-IFOOD", name: "Loja", corporateName: null }]);
    expect(finished.integration).toMatchObject({
      authMode: "LINKED",
      status: "VERIFIED",
      connected: true,
      enabled: true,
      environment: "PRODUCTION",
      externalMerchantId: "merchant-IFOOD",
    });
    const [row] = h.memory.tables.marketplaceIntegration.rows;
    expect(opened(h, row?.credentials)).toEqual({ clientId: "", clientSecret: "", webhookSecret: null, refreshToken: "refresh-1" });
    expect(JSON.stringify(finished)).not.toMatch(/refresh-1|access-1|app-secret/);
    expect(h.memory.tables.marketplaceLinkAttempt.rows).toEqual([]);
  });

  it("selects no merchant when the grant covers several, and the store chooses one of them", async () => {
    const two = { status: 200, body: JSON.stringify([{ id: "m-a", name: "A" }, { id: "m-b", name: "B" }]) };
    const h = createHarness({ http: ifood({ merchants: two }), appCredentials });

    const finished = await linked(h);
    expect(finished.integration.externalMerchantId).toBeNull();

    expect(await h.engine.selectLinkedMerchant({ clientId: TENANT, provider: "IFOOD", merchantId: "m-z" })).toMatchObject({
      kind: "refused",
      code: "UNKNOWN_MERCHANT",
    });
    const chosen = await h.engine.selectLinkedMerchant({ clientId: TENANT, provider: "IFOOD", merchantId: "m-b" });
    expect(chosen).toMatchObject({ kind: "selected", integration: { externalMerchantId: "m-b" } });
  });

  it("never selects a merchant another store's live connection holds", async () => {
    const h = createHarness({ http: ifood(), appCredentials });
    await h.engine.saveIntegration({ clientId: "tenant-2", provider: "IFOOD", externalMerchantId: "merchant-IFOOD" });

    const finished = await linked(h);

    expect(finished.integration.externalMerchantId).toBeNull();
    expect(await h.engine.selectLinkedMerchant({ clientId: TENANT, provider: "IFOOD", merchantId: "merchant-IFOOD" })).toMatchObject({
      code: "MERCHANT_TAKEN",
    });
  });

  it("keeps the attempt when iFood refuses the code, so the person can paste again", async () => {
    const refused = { status: 401, body: JSON.stringify({ error: { code: "Unauthorized", message: "Bad credentials" } }) };
    const h = createHarness({ http: ifood({ token: refused }), appCredentials });
    await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });

    const answer = await h.engine.finishLink({ clientId: TENANT, provider: "IFOOD", authorizationCode: "WRONG", actorId: null });

    expect(answer).toMatchObject({ kind: "refused", code: "CODE_REFUSED", status: 401 });
    expect(h.memory.tables.marketplaceLinkAttempt.rows).toHaveLength(1);
    expect(h.memory.tables.marketplaceIntegration.rows).toEqual([]);
  });

  it("refuses a finish with no start, and one past the code's ten minutes, without calling iFood", async () => {
    const http = ifood();
    const h = createHarness({ http, appCredentials });
    const finish = () => h.engine.finishLink({ clientId: TENANT, provider: "IFOOD", authorizationCode: "A", actorId: null });

    expect(await finish()).toMatchObject({ code: "NO_LINK_IN_PROGRESS" });
    await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
    h.setNow(new Date(h.clock.at.getTime() + 600_000));
    expect(await finish()).toMatchObject({ code: "LINK_EXPIRED" });
    expect(http.requests).toHaveLength(1);
  });

  it("saves the tokens even when the merchant list fails: the code is spent", async () => {
    const h = createHarness({ http: ifood({ merchants: { status: 503, body: "" } }), appCredentials });

    const finished = await linked(h);

    expect(finished.merchants).toBeNull();
    expect(finished.integration).toMatchObject({ authMode: "LINKED", externalMerchantId: null });
  });

  it("reconnects a disconnected store: the connection is unarchived with its audit line", async () => {
    const h = createHarness({ http: ifood(), appCredentials });
    await linked(h);
    await h.engine.upsertIntegrations({ clientId: TENANT, actorId: "user-1", rows: [{ operation: "archive", provider: "IFOOD" }] });
    expect(await h.engine.integrations(TENANT)).toEqual([]);

    await linked(h);

    expect((await h.engine.integrations(TENANT))[0]).toMatchObject({ authMode: "LINKED", archivedAt: null });
    expect(h.audited.map((entry) => entry.action)).toEqual(["marketplace.integration.archive", "marketplace.integration.unarchive"]);
  });

  it("goes back to the store's own app when its credentials are typed again", async () => {
    const h = createHarness({ http: ifood(), appCredentials });
    await linked(h);

    await h.connect();

    expect((await h.engine.integrations(TENANT))[0]).toMatchObject({ authMode: "CREDENTIALS", status: "UNVERIFIED" });
  });
});

describe("a linked connection's calls", () => {
  const FIRST = { attempt: 1, maxAttempts: 3 };

  async function acceptedOrder(h: Harness): Promise<string> {
    await linked(h);
    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);
    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });
    return outcome.orderId;
  }

  it("uses the token the exchange bought, with no grant of any kind", async () => {
    const http = ifood();
    const h = createHarness({ http, appCredentials });
    const orderId = await acceptedOrder(h);
    const before = http.requests.length;

    expect(await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST)).toEqual({ kind: "done", action: "confirm" });

    expect(http.requests.slice(before).map((request) => request.url)).toEqual([
      "https://merchant-api.ifood.com.br/order/v1.0/orders/ext-1/confirm",
    ]);
    expect(http.requests.at(-1)?.headers.Authorization).toBe("Bearer access-1");
  });

  it("refreshes once for concurrent calls, and stores a rotated refresh token", async () => {
    let grants = 0;
    const token = () => {
      grants += 1;
      return { status: 200, body: JSON.stringify({ accessToken: `access-${grants}`, expiresIn: 21600, refreshToken: `refresh-${grants}` }) };
    };
    const http = ifood({ token });
    const h = createHarness({ http, appCredentials });
    const orderId = await acceptedOrder(h);
    h.setNow(new Date(h.clock.at.getTime() + 21_600_000));
    const before = http.requests.length;

    await Promise.all([
      h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST),
      h.engine.readCatalogue({ clientId: TENANT, provider: "IFOOD" }),
    ]);

    const refreshes = http.requests.slice(before).filter((request) => request.url.includes("/oauth/token"));
    expect(refreshes.map(form)).toEqual([{ grantType: "refresh_token", clientId: "app-id", clientSecret: "app-secret", refreshToken: "refresh-1" }]);
    expect(opened(h, h.memory.tables.marketplaceIntegration.rows[0]?.credentials).refreshToken).toBe("refresh-2");
  });

  it("marks the connection FAILED when iFood no longer honours the refresh token", async () => {
    let first = true;
    const token = () => {
      if (first) {
        first = false;
        return { status: 200, body: JSON.stringify({ accessToken: "access-1", expiresIn: 21600, refreshToken: "refresh-1" }) };
      }
      return { status: 401, body: JSON.stringify({ error: { code: "Unauthorized", message: "Bad credentials" } }) };
    };
    const h = createHarness({ http: ifood({ token }), appCredentials });
    const orderId = await acceptedOrder(h);
    h.setNow(new Date(h.clock.at.getTime() + 21_600_000));

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, FIRST);

    expect((await h.engine.integrations(TENANT))[0]?.status).toBe("FAILED");
  });

  it("verifies deliveries with the app's webhook key", async () => {
    const h = createHarness({ http: ifood(), appCredentials });
    await linked(h);

    expect((await h.engine.target(TENANT, "IFOOD"))?.webhookSecret).toBe("app-hook");
  });
});
