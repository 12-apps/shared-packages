import { decodeJwt, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyAccessToken } from "../access-token";
import { isRefreshBindingActive } from "../access-binding";
import { hashToken, issueRefreshToken } from "../refresh";
import { asHarness, registerTestClient, testSigningKey, token } from "./fixtures";

const ORIGIN = "https://app.example.com";
const NOW = Date.parse("2026-10-03T13:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function refreshFlow() {
  const h = await asHarness();
  const { clientId } = await registerTestClient(h.api);
  const root = await issueRefreshToken({ store: h.stores.refreshTokens }, {
    userEmail: "synthetic@example.invalid", userSub: "synthetic-subject",
    clientId, scopes: ["mcp:read", "mcp:write"],
  });
  return { ...h, clientId, root, form: {
    grant_type: "refresh_token", client_id: clientId, refresh_token: root.refreshToken,
  } };
}

async function assertParentLive(h: Awaited<ReturnType<typeof refreshFlow>>) {
  expect(h.stores.refreshTokens.rows().length).toBe(1);
  expect((await h.stores.refreshTokens.findByHash(hashToken(h.root.refreshToken)))?.revokedAt)
    .toBeNull();
}

describe("refresh signing availability", () => {
  it("leaves the parent live when signing is unavailable and recovers after the grace deadline", async () => {
    const h = await refreshFlow();
    const healthy = h.api.context.signingKey;
    h.api.context.signingKey = async () => null;
    const refused = await token(h.api, h.form);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_request" });
    await assertParentLive(h);
    h.api.context.signingKey = healthy;
    vi.setSystemTime(NOW + 31_000);
    expect((await token(h.api, h.form)).status).toBe(200);
  });

  it("leaves the parent live when loading signing material throws", async () => {
    const h = await refreshFlow();
    h.api.context.signingKey = async () => { throw new Error("synthetic signer failure"); };
    await expect(token(h.api, h.form)).rejects.toThrow("synthetic signer failure");
    await assertParentLive(h);
  });

  it("uses the prepared key even when the provider becomes unavailable during rotation", async () => {
    const h = await refreshFlow();
    const healthy = h.api.context.signingKey;
    const key = await healthy();
    const provider = vi.fn().mockResolvedValueOnce(key).mockResolvedValue(null);
    h.api.context.signingKey = provider;
    const response = await token(h.api, h.form);
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    const body = await response.json();
    const identity = await verifyAccessToken(healthy, body.access_token, { origin: ORIGIN });
    expect(identity.subject).toBe("synthetic-subject");
    expect(decodeJwt(body.access_token).client_id === h.clientId).toBe(true);
    expect(decodeJwt(body.access_token).refresh_token_id === hashToken(body.refresh_token)).toBe(true);
    await expect(verifyAccessToken(healthy, body.access_token, {
      origin: ORIGIN, isActive: binding => isRefreshBindingActive(h.stores.refreshTokens, binding),
    })).resolves.toMatchObject({ subject: "synthetic-subject" });
  });

  it("does not replace the prepared key with a key changed by the rotation", async () => {
    const h = await refreshFlow();
    const before = h.api.context.signingKey;
    const after = await testSigningKey();
    const realRotate = h.stores.refreshTokens.rotate.bind(h.stores.refreshTokens);
    vi.spyOn(h.stores.refreshTokens, "rotate").mockImplementation(async (...args) => {
      h.api.context.signingKey = after;
      return realRotate(...args);
    });
    const response = await token(h.api, h.form);
    expect(response.status).toBe(200);
    const body = await response.json();
    await expect(verifyAccessToken(before, body.access_token, { origin: ORIGIN }))
      .resolves.toMatchObject({ subject: "synthetic-subject" });
  });

  it("authenticates the client before loading signing material", async () => {
    const h = await refreshFlow();
    const provider = vi.fn().mockRejectedValue(new Error("must not load"));
    h.api.context.signingKey = provider;
    expect((await token(h.api, { ...h.form, client_id: "unknown-client" })).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
    await assertParentLive(h);
  });

  it("does not consume the parent when a loaded key cannot sign", async () => {
    const h = await refreshFlow();
    const key = await h.api.context.signingKey();
    const { publicKey } = await generateKeyPair("ES256");
    h.api.context.signingKey = async () => ({ ...key!, privateKey: publicKey });
    await expect(token(h.api, h.form)).rejects.toThrow();
    await assertParentLive(h);
  });

  it.each(["missing", "throwing"])("still revokes an out-of-window replay with a %s signer", async failure => {
    const h = await refreshFlow();
    expect((await token(h.api, h.form)).status).toBe(200);
    const provider = vi.fn(async () => {
      if (failure === "throwing") throw new Error("synthetic signer failure");
      return null;
    });
    h.api.context.signingKey = provider;
    vi.setSystemTime(NOW + 30_000);
    const replay = await token(h.api, h.form);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
    expect(h.stores.refreshTokens.rows().every(row => row.revokedAt !== null)).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it("a retry during a signer outage creates no extra successor or revocation", async () => {
    const h = await refreshFlow();
    const healthy = h.api.context.signingKey;
    const issued = await (await token(h.api, h.form)).json();
    h.api.context.signingKey = async () => null;
    const refused = await token(h.api, h.form);
    expect(refused.status).toBe(400);
    expect(h.stores.refreshTokens.rows().length).toBe(2);
    expect(h.stores.refreshTokens.rows().filter(row => !row.revokedAt).length).toBe(1);
    h.api.context.signingKey = healthy;
    const retry = await (await token(h.api, h.form)).json();
    expect(retry.refresh_token === issued.refresh_token).toBe(true);
  });

  it("keeps another client's lineage live during a signer outage", async () => {
    const h = await refreshFlow();
    const other = await registerTestClient(h.api);
    h.api.context.signingKey = async () => null;
    const refused = await token(h.api, { ...h.form, client_id: other.clientId });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_grant" });
    await assertParentLive(h);
  });

  it("validates requested scopes before preparing the signer", async () => {
    const h = await refreshFlow();
    const provider = vi.fn().mockRejectedValue(new Error("must not load"));
    h.api.context.signingKey = provider;
    const refused = await token(h.api, { ...h.form, scope: "ungranted:scope" });
    expect(await refused.json()).toMatchObject({ error: "invalid_scope" });
    expect(provider).not.toHaveBeenCalled();
    await assertParentLive(h);
  });

  it("starts the full grace window after slow signature preparation", async () => {
    const h = await refreshFlow();
    const healthy = h.api.context.signingKey;
    h.api.context.signingKey = async () => {
      vi.setSystemTime(NOW + 31_000);
      return healthy();
    };
    const response = await token(h.api, h.form);
    expect(response.status).toBe(200);
    const issued = await response.json();
    h.api.context.signingKey = healthy;
    vi.setSystemTime(NOW + 31_000 + 29_999);
    const retry = await token(h.api, h.form);
    expect(retry.status).toBe(200);
    expect((await retry.json()).refresh_token === issued.refresh_token).toBe(true);
    vi.setSystemTime(NOW + 31_000 + 30_000);
    expect((await token(h.api, h.form)).status).toBe(400);
    expect(h.stores.refreshTokens.rows().every(row => row.revokedAt !== null)).toBe(true);
  });

  it("binds both concurrent responses to the one claimed successor", async () => {
    const h = await refreshFlow();
    const responses = await Promise.all([token(h.api, h.form), token(h.api, h.form)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const issued = await Promise.all(responses.map(response => response.json()));
    expect(issued[0].refresh_token === issued[1].refresh_token).toBe(true);
    for (const body of issued) {
      expect(decodeJwt(body.access_token).refresh_token_id === hashToken(body.refresh_token)).toBe(true);
      await expect(verifyAccessToken(h.api.context.signingKey, body.access_token, {
        origin: ORIGIN, isActive: binding => isRefreshBindingActive(h.stores.refreshTokens, binding),
      })).resolves.toMatchObject({ subject: "synthetic-subject" });
    }
    expect(h.stores.refreshTokens.rows().length).toBe(2);
  });

  it("a losing claim's signing failure consumes no additional token", async () => {
    const h = await refreshFlow();
    const key = await h.api.context.signingKey();
    h.api.context.signingKey = vi.fn().mockResolvedValueOnce(key).mockResolvedValueOnce(key)
      .mockResolvedValue(null);
    const responses = await Promise.all([token(h.api, h.form), token(h.api, h.form)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    expect(h.stores.refreshTokens.rows().length).toBe(2);
    expect(h.stores.refreshTokens.rows().filter(row => !row.revokedAt).length).toBe(1);
  });
});
