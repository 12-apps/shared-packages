import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../core/adapter";
import { TENANT, createHarness, scriptedHttp, type Harness } from "./harness";

/**
 * A refresh in flight across a re-link (FUT-5613 review, B2 and N2): the
 * rotated token, the access token and the FAILED mark are written only while
 * the connection still holds the blob the refresh started from, so the old
 * grant's late answer writes nothing over the new link. And a finish removes
 * only the attempt it used.
 */

const APP = { clientId: "app-id", clientSecret: "app-secret", webhookSecret: "app-hook" };
const form = (request: MarketplaceHttpRequest) => Object.fromEntries(new URLSearchParams(request.body ?? ""));
const json = (body: unknown, status = 200): MarketplaceHttpResponse => ({ status, body: JSON.stringify(body) });
const opened = (sealed: unknown) => JSON.parse(Buffer.from(String(sealed).slice("sealed:".length), "base64").toString());

/** A promise and its resolve (the lib target predates `Promise.withResolvers`). */
function deferred() {
  const resolvers: (() => void)[] = [];
  const promise = new Promise<void>((resolve) => {
    resolvers.push(resolve);
  });
  return { promise, resolve: () => resolvers[0]?.() };
}

/** iFood with a slow refresh: it answers `late` once released. Each code exchange buys generation n. */
function slowRefresh(late: MarketplaceHttpResponse) {
  const gate = { started: deferred(), released: deferred() };
  const exchanges: MarketplaceHttpRequest[] = [];
  const http = scriptedHttp(async (request) => {
    if (request.url.includes("/oauth/userCode")) {
      return json({ userCode: "U", authorizationCodeVerifier: "v", verificationUrl: "https://p/x", expiresIn: 600 });
    }
    if (request.url.includes("/oauth/token")) {
      if (form(request).grantType === "authorization_code") {
        const generation = exchanges.push(request);
        return json({ accessToken: `access-link${generation}`, expiresIn: 21600, refreshToken: `refresh-link${generation}` });
      }
      gate.started.resolve();
      await gate.released.promise;
      return late;
    }
    return json([{ id: "m-1", name: "L" }]);
  });
  return { http, gate };
}

async function link(h: Harness) {
  await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
  return h.engine.finishLink({ clientId: TENANT, provider: "IFOOD", authorizationCode: "C", actorId: null, enabled: true });
}

const row = (h: Harness) => h.memory.tables.marketplaceIntegration.rows[0];

/** Linked, its access token expired, a refresh started with refresh-link1 and held; then the store links again. */
async function staleRefreshAcrossRelink(late: MarketplaceHttpResponse) {
  const { http, gate } = slowRefresh(late);
  const h = createHarness({ http, appCredentials: () => APP });
  await link(h);
  h.setNow(new Date(h.clock.at.getTime() + 21_600_000));
  const stale = h.engine.linkedMerchants({ clientId: TENANT, provider: "IFOOD" });
  await gate.started.promise;
  await link(h);
  expect(opened(row(h)?.credentials).refreshToken).toBe("refresh-link2");
  gate.released.resolve();
  await stale;
  return { h, http };
}

describe("a refresh that lost the race to a re-link", () => {
  it("writes neither the rotated refresh token nor its access token over the new link's", async () => {
    const { h, http } = await staleRefreshAcrossRelink(
      json({ accessToken: "access-OLD-rotated", expiresIn: 21600, refreshToken: "refresh-OLD-rotated" }),
    );

    expect(opened(row(h)?.credentials).refreshToken).toBe("refresh-link2");
    const before = http.requests.length;
    await h.engine.linkedMerchants({ clientId: TENANT, provider: "IFOOD" });
    expect(http.requests.slice(before).at(-1)?.headers.Authorization).toBe("Bearer access-link2");
  });

  it("does not cache the old grant's access token when nothing rotated", async () => {
    const { h, http } = await staleRefreshAcrossRelink(json({ accessToken: "access-OLD", expiresIn: 21600 }));

    const before = http.requests.length;
    await h.engine.linkedMerchants({ clientId: TENANT, provider: "IFOOD" });
    expect(http.requests.slice(before).at(-1)?.headers.Authorization).toBe("Bearer access-link2");
  });

  it("does not mark the freshly linked connection FAILED when iFood refuses the stale token", async () => {
    const { h } = await staleRefreshAcrossRelink(json({ error: { code: "Unauthorized", message: "Bad credentials" } }, 401));

    expect(row(h)?.status).toBe("VERIFIED");
    expect(opened(row(h)?.credentials).refreshToken).toBe("refresh-link2");
  });
});

describe("a finish in flight while the store starts again", () => {
  it("removes only the attempt it used: the new code survives", async () => {
    const started = deferred();
    const released = deferred();
    const asked: MarketplaceHttpRequest[] = [];
    const http = scriptedHttp(async (request) => {
      if (request.url.includes("/oauth/userCode")) {
        const codes = asked.push(request);
        return json({ userCode: `CODE-${codes}`, authorizationCodeVerifier: `v-${codes}`, verificationUrl: "https://p/x", expiresIn: 600 });
      }
      if (request.url.includes("/oauth/token")) {
        started.resolve();
        await released.promise;
        return json({ accessToken: "a", expiresIn: 21600, refreshToken: "r" });
      }
      return json([{ id: "m-1", name: "L" }]);
    });
    const h = createHarness({ http, appCredentials: () => APP });
    await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
    const finishing = h.engine.finishLink({ clientId: TENANT, provider: "IFOOD", authorizationCode: "C", actorId: null });
    await started.promise;

    await h.engine.startLink({ clientId: TENANT, provider: "IFOOD" });
    released.resolve();
    expect(await finishing).toMatchObject({ kind: "linked" });

    expect((await h.engine.linkState({ clientId: TENANT, provider: "IFOOD" })).pending?.userCode).toBe("CODE-2");
  });
});
