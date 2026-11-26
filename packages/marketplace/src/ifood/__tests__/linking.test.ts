import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import type { LinkCallContext } from "../../core/linking-port";
import { IFOOD_LINKING } from "../linking";

/**
 * iFood's distributed-app authentication, the wire format alone (FUT-5613).
 * Every fixture is the documented example of
 * developer.ifood.com.br/pt-BR/docs/guides/modules/authentication/distributed.md
 * and .../merchant/endpoints.md, read 2026-11-26. No call leaves the process.
 */

const APP = { clientId: "app-id", clientSecret: "app-secret", webhookSecret: "hook" };

function fake(answers: MarketplaceHttpResponse[] | (() => never)) {
  const requests: MarketplaceHttpRequest[] = [];
  const ctx: LinkCallContext = {
    credentials: APP,
    environment: "PRODUCTION",
    now: new Date("2026-11-26T12:00:00.000Z"),
    http: async (request) => {
      requests.push(request);
      if (typeof answers === "function") return answers();
      return answers[Math.min(requests.length - 1, answers.length - 1)]!;
    },
  };
  return { ctx, requests };
}

/** A copy of `source` without `keys`: a documented answer with fields left out. */
function without<T extends object>(source: T, ...keys: (keyof T)[]): Partial<T> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key as keyof T))) as Partial<T>;
}

const form = (request: MarketplaceHttpRequest | undefined) => Object.fromEntries(new URLSearchParams(request?.body ?? ""));

/** The documented 200 of `POST /oauth/userCode`. */
const USER_CODE = {
  userCode: "HJLX-LPSQ",
  authorizationCodeVerifier: "test123",
  verificationUrl: "https://portal.ifood.com.br/apps/code",
  verificationUrlComplete: "https://portal.ifood.com.br/apps/code?c=HJLX-LPSQ",
  expiresIn: 600,
};

/** The documented 200 of `POST /oauth/token`, with the refresh token step 6 says it returns (field name ESTIMATED). */
const TOKEN = { accessToken: "eyJ0eXAi.access", type: "bearer", expiresIn: 21600, refreshToken: "refresh-1" };

describe("iFood's user code", () => {
  it("asks with the app's client id, form-encoded, and reads every documented field", async () => {
    const { ctx, requests } = fake([{ status: 200, body: JSON.stringify(USER_CODE) }]);

    const answer = await IFOOD_LINKING.requestCode(ctx);

    expect(answer).toEqual({
      kind: "ok",
      value: {
        userCode: "HJLX-LPSQ",
        verifier: "test123",
        verificationUrl: "https://portal.ifood.com.br/apps/code",
        verificationUrlComplete: "https://portal.ifood.com.br/apps/code?c=HJLX-LPSQ",
        expiresInSeconds: 600,
      },
    });
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/userCode");
    expect(requests[0]?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(form(requests[0])).toEqual({ clientId: "app-id" });
  });

  it("takes the documented ten minutes when no expiry is answered, and the bare URL when no complete one is", async () => {
    const bare = without(USER_CODE, "verificationUrlComplete", "expiresIn");
    const { ctx } = fake([{ status: 200, body: JSON.stringify(bare) }]);

    const answer = await IFOOD_LINKING.requestCode(ctx);

    expect(answer).toMatchObject({
      kind: "ok",
      value: { expiresInSeconds: 600, verificationUrlComplete: "https://portal.ifood.com.br/apps/code" },
    });
  });

  it("refuses an answer without a verifier: the exchange could never succeed", async () => {
    const missing = without(USER_CODE, "authorizationCodeVerifier");
    const { ctx } = fake([{ status: 200, body: JSON.stringify(missing) }]);

    expect(await IFOOD_LINKING.requestCode(ctx)).toMatchObject({ kind: "refused", status: 200 });
  });

  it("refuses a 401 for good, and asks again after a 500 or a network error", async () => {
    const unauthorized = { error: { code: "Unauthorized", message: "Bad credentials" } };
    expect(await IFOOD_LINKING.requestCode(fake([{ status: 401, body: JSON.stringify(unauthorized) }]).ctx)).toMatchObject({
      kind: "refused",
      status: 401,
    });
    expect(await IFOOD_LINKING.requestCode(fake([{ status: 500, body: "{}" }]).ctx)).toMatchObject({ kind: "retry" });
    const down = fake(() => {
      throw new Error("socket hang up");
    });
    expect(await IFOOD_LINKING.requestCode(down.ctx)).toEqual({ kind: "retry", reason: "socket hang up" });
  });
});

describe("iFood's token grants", () => {
  it("exchanges the authorization code and its verifier with grantType authorization_code", async () => {
    const { ctx, requests } = fake([{ status: 200, body: JSON.stringify(TOKEN) }]);

    const answer = await IFOOD_LINKING.exchange(ctx, { authorizationCode: "AUTH_CODE", verifier: "test123" });

    expect(answer).toEqual({
      kind: "ok",
      value: { accessToken: "eyJ0eXAi.access", refreshToken: "refresh-1", expiresInSeconds: 21600 },
    });
    expect(requests[0]?.url).toBe("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token");
    expect(form(requests[0])).toEqual({
      grantType: "authorization_code",
      clientId: "app-id",
      clientSecret: "app-secret",
      authorizationCode: "AUTH_CODE",
      authorizationCodeVerifier: "test123",
    });
  });

  it("refuses an exchange answered without a refresh token: the store could not stay linked", async () => {
    const documented = without(TOKEN, "refreshToken");
    const { ctx } = fake([{ status: 200, body: JSON.stringify(documented) }]);

    expect(await IFOOD_LINKING.exchange(ctx, { authorizationCode: "A", verifier: "V" })).toMatchObject({ kind: "refused" });
  });

  it("reads a snake-case refresh token too (the field name is ESTIMATED)", async () => {
    const documented = without(TOKEN, "refreshToken");
    const { ctx } = fake([{ status: 200, body: JSON.stringify({ ...documented, refresh_token: "refresh-snake" }) }]);

    expect(await IFOOD_LINKING.exchange(ctx, { authorizationCode: "A", verifier: "V" })).toMatchObject({
      kind: "ok",
      value: { refreshToken: "refresh-snake" },
    });
  });

  it("refreshes with grantType refresh_token, and a refresh answered without a new one keeps the old", async () => {
    const documented = without(TOKEN, "refreshToken");
    const { ctx, requests } = fake([{ status: 200, body: JSON.stringify(documented) }]);

    const answer = await IFOOD_LINKING.refresh(ctx, { refreshToken: "refresh-1" });

    expect(answer).toEqual({ kind: "ok", value: { accessToken: "eyJ0eXAi.access", refreshToken: null, expiresInSeconds: 21600 } });
    expect(form(requests[0])).toEqual({
      grantType: "refresh_token",
      clientId: "app-id",
      clientSecret: "app-secret",
      refreshToken: "refresh-1",
    });
  });

  it("refuses a wrong code (401) for good", async () => {
    const { ctx } = fake([{ status: 401, body: JSON.stringify({ error: { code: "Unauthorized", message: "Bad credentials" } }) }]);

    expect(await IFOOD_LINKING.exchange(ctx, { authorizationCode: "WRONG", verifier: "V" })).toMatchObject({
      kind: "refused",
      status: 401,
    });
  });
});

describe("iFood's merchant list", () => {
  const merchant = (id: string) => ({ id, name: "Pizzaria Central", corporateName: "Pizzaria Central LTDA" });

  it("lists the stores the token covers with its bearer", async () => {
    const { ctx, requests } = fake([{ status: 200, body: JSON.stringify([merchant("550e8400-e29b-41d4-a716-446655440000")]) }]);

    const answer = await IFOOD_LINKING.merchants(ctx, { accessToken: "tok" });

    expect(answer).toEqual({
      kind: "ok",
      value: [{ id: "550e8400-e29b-41d4-a716-446655440000", name: "Pizzaria Central", corporateName: "Pizzaria Central LTDA" }],
    });
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("https://merchant-api.ifood.com.br/merchant/v1.0/merchants?page=1&size=100");
    expect(requests[0]?.headers.Authorization).toBe("Bearer tok");
  });

  it("reads the next page while a page is full", async () => {
    const full = Array.from({ length: 100 }, (_, index) => merchant(`m-${index}`));
    const paged = fake([
      { status: 200, body: JSON.stringify(full) },
      { status: 200, body: JSON.stringify([merchant("m-last")]) },
    ]);

    const answer = await IFOOD_LINKING.merchants(paged.ctx, { accessToken: "tok" });

    expect(answer.kind === "ok" ? answer.value.length : 0).toBe(101);
    expect(paged.requests.map((request) => request.url.split("?")[1])).toEqual(["page=1&size=100", "page=2&size=100"]);
  });

  it("refuses an answer that is not a list", async () => {
    const { ctx } = fake([{ status: 200, body: JSON.stringify({ merchants: [] }) }]);

    expect(await IFOOD_LINKING.merchants(ctx, { accessToken: "tok" })).toMatchObject({ kind: "refused" });
  });
});
