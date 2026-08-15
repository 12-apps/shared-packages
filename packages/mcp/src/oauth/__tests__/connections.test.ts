import { describe, expect, it } from "vitest";

import { asHarness } from "./fixtures";
import { disconnectAiHost, listAiConnections } from "../connections";
import type { NewRefreshToken } from "../stores";

/**
 * The account surface's connection operations (12-48).
 *
 * The case that matters most here is the disconnect's BOTH-halves rule: revoking
 * the connection rows without ending the refresh tokens is a disconnect that
 * undoes itself — the assistant rotates its live token and the next grant records
 * fresh activity. These tests pin that both halves happen in one call, and that
 * only the disconnected clients' tokens are touched.
 */

const USER_ID = "user-1";
const EMAIL = "owner@example.com";
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function refreshToken(overrides: Partial<NewRefreshToken>): NewRefreshToken {
  return {
    tokenHash: "hash-1",
    userEmail: EMAIL,
    userSub: "google-sub-1",
    clientId: "client-1",
    scopes: ["mcp:read"],
    expiresAt: new Date(FIXED_NOW.getTime() + 86_400_000),
    rotatedFrom: null,
    ...overrides,
  };
}

async function connect(
  stores: Awaited<ReturnType<typeof asHarness>>["stores"],
  oauthClientId: string,
  host: string | null,
): Promise<void> {
  await stores.connections.recordActivity({
    userId: USER_ID,
    oauthClientId,
    clientName: `${oauthClientId} name`,
    host,
    at: FIXED_NOW,
  });
}

describe("listAiConnections", () => {
  it("narrows the stored open host string to the AiProvider union", async () => {
    const { stores } = await asHarness();
    await connect(stores, "client-claude", "claude");
    await connect(stores, "client-desktop", "claude-desktop");
    await connect(stores, "client-unknown", "some-future-host");
    await connect(stores, "client-fresh", null);

    const listed = await listAiConnections(stores.connections, USER_ID);
    const byClient = new Map(listed.map((row) => [row.oauthClientId, row.host]));

    expect(byClient.get("client-claude")).toBe("claude");
    // The narrowing is providerForHostId, the same attribution vocabulary the
    // rest of the package uses — not a bare equality check re-derived per host.
    expect(byClient.get("client-desktop")).toBe("claude");
    expect(byClient.get("client-unknown")).toBeNull();
    expect(byClient.get("client-fresh")).toBeNull();
  });
});

describe("disconnectAiHost", () => {
  it("revokes the connection rows AND every live refresh token of those clients", async () => {
    const { stores } = await asHarness();
    await connect(stores, "client-claude", "claude");
    await connect(stores, "client-chatgpt", "chatgpt");
    // Two live tokens for the disconnected client (a rotation family in flight),
    // one for the client that must remain untouched.
    await stores.refreshTokens.create(refreshToken({ tokenHash: "claude-1", clientId: "client-claude" }));
    await stores.refreshTokens.create(refreshToken({ tokenHash: "claude-2", clientId: "client-claude" }));
    await stores.refreshTokens.create(refreshToken({ tokenHash: "chatgpt-1", clientId: "client-chatgpt" }));

    const result = await disconnectAiHost(stores, { userId: USER_ID, email: EMAIL }, "claude");

    expect(result.disconnectedClientIds).toEqual(["client-claude"]);
    expect(result.revokedRefreshTokens).toBe(2);

    const tokens = new Map(stores.refreshTokens.rows().map((row) => [row.tokenHash, row.revokedAt]));
    expect(tokens.get("claude-1")).not.toBeNull();
    expect(tokens.get("claude-2")).not.toBeNull();
    // The other provider's grant is not collateral damage.
    expect(tokens.get("chatgpt-1")).toBeNull();

    const remaining = await listAiConnections(stores.connections, USER_ID);
    expect(remaining.map((row) => row.oauthClientId)).toEqual(["client-chatgpt"]);
  });

  it("is idempotent: a repeat (or never-connected) disconnect reports zero, not an error", async () => {
    const { stores } = await asHarness();
    await connect(stores, "client-claude", "claude");
    await stores.refreshTokens.create(refreshToken({ tokenHash: "claude-1", clientId: "client-claude" }));

    const first = await disconnectAiHost(stores, { userId: USER_ID, email: EMAIL }, "claude");
    expect(first.disconnectedClientIds).toEqual(["client-claude"]);
    expect(first.revokedRefreshTokens).toBe(1);

    const second = await disconnectAiHost(stores, { userId: USER_ID, email: EMAIL }, "claude");
    expect(second.disconnectedClientIds).toEqual([]);
    expect(second.revokedRefreshTokens).toBe(0);

    const never = await disconnectAiHost(stores, { userId: USER_ID, email: EMAIL }, "codex");
    expect(never.disconnectedClientIds).toEqual([]);
    expect(never.revokedRefreshTokens).toBe(0);
  });

  it("ends the tokens of a claimed legacy (unattributed) connection too", async () => {
    const { stores } = await asHarness();
    // A pre-attribution connection: the store's revokeByHost claims it when the
    // provider has no attributed rows, and the returned client id must flow into
    // the refresh-token half like any other.
    await connect(stores, "client-legacy", null);
    await stores.refreshTokens.create(refreshToken({ tokenHash: "legacy-1", clientId: "client-legacy" }));

    const result = await disconnectAiHost(stores, { userId: USER_ID, email: EMAIL }, "claude");

    expect(result.disconnectedClientIds).toEqual(["client-legacy"]);
    expect(result.revokedRefreshTokens).toBe(1);
  });
});
