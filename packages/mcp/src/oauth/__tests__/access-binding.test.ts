import { decodeJwt } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRefreshBindingActive } from "../access-binding";
import { signAccessToken, verifyAccessToken } from "../access-token";
import { hashToken, issueRefreshToken } from "../refresh";
import { disconnectAiHost } from "../connections";
import { asHarness, authorize, codeFrom, pkcePair, registerTestClient, token } from "./fixtures";

const ORIGIN = "https://app.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
afterEach(() => vi.useRealTimers());
const RESOURCE = new Request(`${ORIGIN}/api/mcp`);
interface Grant { access_token: string; refresh_token: string }

async function setup() {
  const harness = await asHarness();
  const { clientId } = await registerTestClient(harness.api);
  const pair = await pkcePair();
  harness.api.context.isAccessTokenActive = (binding) => isRefreshBindingActive(harness.stores.refreshTokens, binding);
  const grant = async (): Promise<Grant> => {
    const code = codeFrom(await authorize(harness.api, {
      response_type: "code", client_id: clientId, redirect_uri: CALLBACK,
      code_challenge: pair.challenge, code_challenge_method: "S256", scope: "mcp:read",
    }));
    const result = await token(harness.api, {
      grant_type: "authorization_code", code, redirect_uri: CALLBACK,
      client_id: clientId, code_verifier: pair.verifier,
    });
    expect(result.status).toBe(200);
    return result.json() as Promise<Grant>;
  };
  return { ...harness, clientId, grant };
}

describe("refresh-bound access tokens", () => {
  it("upgrades an existing refresh grant to bound access without a cookie login or scope widening", async () => {
    const h = await setup();
    const existing = await issueRefreshToken({ store: h.stores.refreshTokens }, {
      userEmail: "owner@example.com", userSub: "google-sub-1", clientId: h.clientId, scopes: ["mcp:read"],
    });
    h.session.current = null;
    const form = { grant_type: "refresh_token", client_id: h.clientId, refresh_token: existing.refreshToken };
    const broadened = await token(h.api, { ...form, scope: "mcp:read mcp:write" });
    expect(broadened.status).toBe(400);
    expect(await broadened.json()).toMatchObject({ error: "invalid_scope" });
    const refreshed = await token(h.api, form);
    expect(refreshed.status).toBe(200);
    const issued = await refreshed.json() as Grant;
    expect(decodeJwt(issued.access_token).refresh_token_id).toBe(hashToken(issued.refresh_token));
    await expect(h.api.verifyBearer(issued.access_token, RESOURCE)).resolves.toMatchObject({
      email: "owner@example.com", subject: "google-sub-1", scopes: ["mcp:read"],
    });
  });
  it("keeps grace retries usable but refuses all access after replay revokes the lineage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-10T12:00:00.000Z"));
    const h = await setup();
    const first = await h.grant();
    const rotate = () => token(h.api, {
      grant_type: "refresh_token", client_id: h.clientId, refresh_token: first.refresh_token,
    });
    const next = await (await rotate()).json() as Grant;
    const retry = await (await rotate()).json() as Grant;
    expect(retry.refresh_token).toBe(next.refresh_token);
    await expect(h.api.verifyBearer(first.access_token, RESOURCE)).resolves.toBeDefined();
    await expect(h.api.verifyBearer(retry.access_token, RESOURCE)).resolves.toBeDefined();
    vi.setSystemTime(Date.parse("2026-09-10T12:01:00.000Z"));
    expect((await rotate()).status).toBe(400);
    await expect(h.api.verifyBearer(first.access_token, RESOURCE)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(h.api.verifyBearer(next.access_token, RESOURCE)).rejects.toMatchObject({ code: "invalid_token" });
  });
  it("binds both grants to their issued refresh row and preserves old access across rotation", async () => {
    const h = await setup();
    const first = await h.grant();
    const claims = decodeJwt(first.access_token);
    expect(claims.client_id).toBe(h.clientId);
    expect(claims.refresh_token_id).toBe(hashToken(first.refresh_token));
    expect(JSON.stringify(claims)).not.toContain(first.refresh_token);
    await expect(h.api.verifyBearer(first.access_token, RESOURCE)).resolves.toMatchObject({ email: "owner@example.com" });
    const rotation = await token(h.api, {
      grant_type: "refresh_token", client_id: h.clientId, refresh_token: first.refresh_token,
    });
    const second = await rotation.json() as Grant;
    expect(decodeJwt(second.access_token).refresh_token_id).toBe(hashToken(second.refresh_token));
    await expect(h.api.verifyBearer(first.access_token, RESOURCE)).resolves.toBeDefined();
    await expect(h.api.verifyBearer(second.access_token, RESOURCE)).resolves.toMatchObject({ email: "owner@example.com" });
  });

  it("disconnects immediately and a same-second reconnect never revives old access", async () => {
    const h = await setup();
    const first = await h.grant();
    await disconnectAiHost(h.stores, { userId: "user-1", email: "owner@example.com" }, "claude");
    await expect(h.api.verifyBearer(first.access_token, RESOURCE)).rejects.toMatchObject({ code: "invalid_token" });
    const second = await h.grant();
    expect(await h.stores.connections.listActive("user-1")).toHaveLength(1);
    await expect(h.api.verifyBearer(second.access_token, RESOURCE)).resolves.toBeDefined();
    await expect(h.api.verifyBearer(first.access_token, RESOURCE)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("refuses expired/missing rows and identity or client mismatches", async () => {
    const h = await setup();
    const first = await h.grant();
    const row = h.stores.refreshTokens.rows()[0]!;
    const binding = {
      email: row.userEmail, subject: row.userSub, clientId: row.clientId,
      refreshTokenHash: hashToken(first.refresh_token), issuedAt: 0,
    };
    expect(await isRefreshBindingActive(h.stores.refreshTokens, binding, row.expiresAt.getTime())).toBe(false);
    for (const change of [
      { email: "other@example.com" }, { subject: "other-sub" }, { clientId: "other-client" },
      { refreshTokenHash: "0".repeat(64) },
    ]) {
      expect(await isRefreshBindingActive(h.stores.refreshTokens, { ...binding, ...change })).toBe(false);
    }
  });

  it("fails closed on missing legacy binding and store outages", async () => {
    const h = await setup();
    const legacy = await signAccessToken(h.api.context.signingKey, {
      email: "owner@example.com", subject: "google-sub-1", scopes: ["mcp:read"], origin: ORIGIN,
    });
    await expect(h.api.verifyBearer(legacy ?? "", RESOURCE)).rejects.toMatchObject({ reason: "incomplete" });
    const grant = await h.grant();
    h.api.context.isAccessTokenActive = () => { throw new Error("database unavailable"); };
    await expect(h.api.verifyBearer(grant.access_token, RESOURCE)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("never calls persistence for an unverified signature or audience", async () => {
    const h = await setup();
    const calls = { count: 0 };
    const isActive = () => { calls.count += 1; return true; };
    const grant = await h.grant();
    await expect(verifyAccessToken(h.api.context.signingKey, "not-a-token", { origin: ORIGIN, isActive })).rejects.toThrow();
    await expect(verifyAccessToken(h.api.context.signingKey, grant.access_token, {
      origin: "https://other.example.com", isActive,
    })).rejects.toThrow();
    expect(calls.count).toBe(0);
  });
});
