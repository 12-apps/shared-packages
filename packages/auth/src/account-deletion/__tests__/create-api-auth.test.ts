// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createApiAuth } from "../../create-api-auth";
import { encodeSessionToken, sessionCookieName } from "../../server/session-token";
import type { AccountDeletionConfig } from "../types";
import { memoryDb } from "./memory-db";

const ORIGIN = "https://app.example.com";
const TOKEN = { secret: "synthetic-test-secret-at-least-32-characters", baseUrl: ORIGIN, maxAgeSeconds: 3600 };
const IDENTITY = { id: "oauth-sub", email: "pessoa@example.com", name: "P", image: null, provider: "google", isSuperadmin: false };
const COOKIE = sessionCookieName(TOKEN);

function api() {
  const db = memoryDb();
  const deletion: AccountDeletionConfig = {
    graceDays: 15,
    timeZone: "UTC",
    userIdByEmail: async (email) => (email === IDENTITY.email ? "u1" : null),
    resolveCaller: async () => ({ userId: "u1", email: IDENTITY.email }),
    hasPassword: async () => true,
    checkPassword: async () => "ok",
    erase: async () => undefined,
    emailOf: async () => IDENTITY.email,
    mail: async () => undefined,
    audit: async () => undefined,
    getDb: () => db,
  };
  const apiAuth = createApiAuth({ secret: TOKEN.secret, authUrl: ORIGIN, trustHost: true, providers: [], accountDeletion: deletion });
  return { apiAuth, db };
}

const request = (cookie: string): Request => new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie: `${COOKIE}=${cookie}` } });
const minted = (claims: Record<string, string>) => encodeSessionToken(TOKEN, { ...IDENTITY, claims });

describe("createApiAuth({ accountDeletion })", () => {
  it("stamps uid (by e-mail when the host gave none), sv and at at sign-in", async () => {
    const { apiAuth } = api();
    const signedIn = await apiAuth.config.callbacks?.jwt?.({ token: {}, user: IDENTITY, account: { provider: "google" } } as never);
    expect(signedIn?.claims).toMatchObject({ uid: "u1", sv: "0" });
    expect((signedIn?.claims as Record<string, string> | undefined)?.at).toMatch(/^\d+$/);
  });

  it("refuses a stale token from auth() AND the session endpoint, which clears the cookie", async () => {
    const { apiAuth } = api();
    const old = await minted({ uid: "u1", sv: "0" });
    expect((await apiAuth.auth(request(old)))?.user?.email).toBe(IDENTITY.email);
    await apiAuth.accountDeletion?.schedule({ userId: "u1", email: IDENTITY.email }, "pw");
    expect(await apiAuth.auth(request(old))).toBeNull();
    const response = await apiAuth.handlers.GET(request(old));
    expect(await response.json()).toEqual({});
    expect(response.headers.get("set-cookie")).toContain(`${COOKIE}=;`);
  });

  it("places a token with no uid claim by its e-mail: never fail-open", async () => {
    const { apiAuth } = api();
    const claimless = await minted({});
    await apiAuth.accountDeletion?.schedule({ userId: "u1", email: IDENTITY.email }, "pw");
    expect(await apiAuth.auth(request(claimless))).toBeNull();
  });

  it("is fail-closed for a pending session unless asked, and the session endpoint carries the date", async () => {
    const { apiAuth } = api();
    await apiAuth.accountDeletion?.schedule({ userId: "u1", email: IDENTITY.email }, "pw");
    const fresh = await minted({ uid: "u1", sv: "1" });
    expect(await apiAuth.auth(request(fresh))).toBeNull();
    const allowed = await apiAuth.auth(request(fresh), { allowPending: true });
    expect((allowed as { deletion?: { purgeAt: string } } | null)?.deletion?.purgeAt).toMatch(/Z$/);
    const body = (await (await apiAuth.handlers.GET(request(fresh))).json()) as { deletion?: { purgeAt: string } };
    expect(body.deletion?.purgeAt).toMatch(/Z$/);
  });

  it("clears a __Secure- cookie with a Secure clearing cookie on https", async () => {
    const { apiAuth } = api();
    const old = await minted({ uid: "u1", sv: "0" });
    await apiAuth.accountDeletion?.schedule({ userId: "u1", email: IDENTITY.email }, "pw");
    const cleared = (await apiAuth.handlers.GET(request(old))).headers.get("set-cookie") ?? "";
    expect(COOKIE.startsWith("__Secure-")).toBe(true);
    expect(cleared).toMatch(/^__Secure-[^=]+=;.*; Secure$/);
  });
});
