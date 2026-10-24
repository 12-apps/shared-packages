// @vitest-environment node
import { decode, encode } from "@auth/core/jwt";
import { describe, expect, it } from "vitest";

import { createApiAuth } from "../create-api-auth";
import { encodeSessionToken, sessionCookieName } from "../server/session-token";

const ORIGIN = "https://app.example.com";
const CONFIG = { secret: "synthetic-test-secret-at-least-32-characters", baseUrl: ORIGIN, maxAgeSeconds: 3600 };
const IDENTITY = { id: "user-one", email: "owner@example.com", name: "Owner", image: null, provider: "google", isSuperadmin: false };
const COOKIE_NAME = sessionCookieName(CONFIG);

function request(cookie: string, path = "/api/auth/session"): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { cookie: `${COOKIE_NAME}=${cookie}` } });
}

function refreshedCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((entry) => entry.startsWith(`${COOKIE_NAME}=`));
  if (!header) throw new Error("Auth.js did not refresh its session cookie");
  return header.slice(COOKIE_NAME.length + 1).split(";")[0] ?? "";
}

describe("stable per-login session binding", () => {
  it("preserves the login nonce when the real Auth.js session endpoint renews its cookie", async () => {
    const api = createApiAuth({ secret: CONFIG.secret, authUrl: ORIGIN, trustHost: true, providers: [] });
    const firstCookie = await encodeSessionToken(CONFIG, IDENTITY);
    const first = await api.auth(request(firstCookie, "/api/oauth/authorize"));
    expect(first?.loginSessionId).toMatch(/^[a-f0-9-]{36}$/);
    const refreshed = await api.handlers.GET(request(firstCookie));
    expect(refreshed.status).toBe(200);
    const secondCookie = refreshedCookie(refreshed);
    expect(secondCookie).not.toBe(firstCookie);
    const second = await api.auth(request(secondCookie, "/api/oauth/consent"));
    expect(second?.loginSessionId).toBe(first?.loginSessionId);
    expect(second?.user.email).toBe(first?.user.email);
    const replacementCookie = await encodeSessionToken(CONFIG, IDENTITY);
    const replacement = await api.auth(request(replacementCookie));
    expect(replacement?.loginSessionId).not.toBe(first?.loginSessionId);
  });

  it("stamps a new nonce at genuine sign-in, preserves refresh, and ignores client update claims", async () => {
    const { config } = createApiAuth({ secret: CONFIG.secret, providers: [], adminEmails: "" });
    const first = await config.callbacks?.jwt?.({
      token: { loginSessionId: "client-chosen" }, user: IDENTITY, account: { provider: "google" },
    } as never);
    expect(first?.loginSessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(first?.loginSessionId).not.toBe("client-chosen");
    const renewal = await config.callbacks?.jwt?.({
      token: first, trigger: "update", session: { loginSessionId: "attacker-replacement" },
    } as never);
    expect(renewal?.loginSessionId).toBe(first?.loginSessionId);
    const nextLogin = await config.callbacks?.jwt?.({ token: first, user: IDENTITY, account: { provider: "google" } } as never);
    expect(nextLogin?.loginSessionId).not.toBe(first?.loginSessionId);
  });

  it("does not invent a nonce while reading or refreshing an authenticated legacy cookie", async () => {
    const api = createApiAuth({ secret: CONFIG.secret, authUrl: ORIGIN, trustHost: true, providers: [] });
    const legacy = await encode({ secret: CONFIG.secret, salt: COOKIE_NAME, token: { sub: IDENTITY.id, email: IDENTITY.email } });
    const session = await api.auth(request(legacy));
    expect(session?.user.email).toBe(IDENTITY.email);
    expect(session?.loginSessionId).toBeUndefined();
    const response = await api.handlers.GET(request(legacy));
    const renewed = await decode({ secret: CONFIG.secret, salt: COOKIE_NAME, token: refreshedCookie(response) });
    expect(renewed?.loginSessionId).toBeUndefined();
  });
});

describe("sign-in claims (FUT-3906)", () => {
  it("stamps the host's claims once at sign-in and reads them back on every request", async () => {
    const seen: { email: string; provider: string | null }[] = [];
    const api = createApiAuth({
      secret: CONFIG.secret,
      authUrl: ORIGIN,
      trustHost: true,
      providers: [],
      signInClaims: async (params) => {
        seen.push(params);
        return { uid: "db-user-1" };
      },
    });
    const signedIn = await api.config.callbacks?.jwt?.({
      token: {}, user: IDENTITY, account: { provider: "google" },
    } as never);
    expect(signedIn?.claims).toEqual({ uid: "db-user-1" });
    expect(seen).toEqual([{ email: IDENTITY.email, provider: "google" }]);

    // A renewal keeps them without asking the host again.
    const renewed = await api.config.callbacks?.jwt?.({ token: signedIn } as never);
    expect(renewed?.claims).toEqual({ uid: "db-user-1" });
    expect(seen).toHaveLength(1);

    const cookie = await encodeSessionToken(CONFIG, { ...IDENTITY, claims: { uid: "db-user-1" } });
    const session = await api.auth(request(cookie));
    expect(session?.claims).toEqual({ uid: "db-user-1" });
  });

  it("reads no claims from a session minted before them, nor anything that is not a string map", async () => {
    const api = createApiAuth({ secret: CONFIG.secret, authUrl: ORIGIN, trustHost: true, providers: [] });
    const legacy = await encode({ secret: CONFIG.secret, salt: COOKIE_NAME, token: { sub: IDENTITY.id, email: IDENTITY.email } });
    expect((await api.auth(request(legacy)))?.claims).toEqual({});
    const odd = await encode({
      secret: CONFIG.secret, salt: COOKIE_NAME,
      token: { sub: IDENTITY.id, email: IDENTITY.email, claims: { uid: 7, ok: "yes" } },
    });
    expect((await api.auth(request(odd)))?.claims).toEqual({ ok: "yes" });
  });
});
