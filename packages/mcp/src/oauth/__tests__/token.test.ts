import { describe, expect, it } from "vitest";

import { asHarness, authorize, codeFrom, pkcePair, registerTestClient, token } from "./fixtures";
import { verifyAccessToken } from "../access-token";

/**
 * The token endpoint (12-23) — the port of future-pay's grant suites.
 *
 * Every case is an invariant a reviewer of an AS should insist on: single-use
 * codes, PKCE actually verified, the bound `redirect_uri` re-checked, client
 * authentication for both client types, refresh rotation that revokes the lineage
 * on replay and can only narrow scope, and NOTHING stored in plaintext.
 */

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const ORIGIN = "https://app.example.com";

interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Run the whole happy path and hand back everything a case might assert on. */
async function grantedFlow(options?: { scope?: string; confidential?: boolean }) {
  const harness = await asHarness();
  const { clientId, clientSecret } = await registerTestClient(harness.api, {
    ...(options?.scope ? { scope: options.scope } : {}),
    ...(options?.confidential ? { token_endpoint_auth_method: "client_secret_basic" } : {}),
  });
  const { verifier, challenge } = await pkcePair();
  const code = codeFrom(
    await authorize(harness.api, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: options?.scope ?? "mcp:read mcp:write",
    }),
  );
  return { ...harness, clientId, clientSecret, verifier, challenge, code };
}

const codeForm = (clientId: string, code: string, verifier: string): Record<string, string> => ({
  grant_type: "authorization_code",
  code,
  redirect_uri: CALLBACK,
  code_verifier: verifier,
  client_id: clientId,
});

describe("authorization_code grant", () => {
  it("issues a verifiable access token and a refresh token", async () => {
    const { api, clientId, code, verifier } = await grantedFlow();
    const response = await token(api, codeForm(clientId, code, verifier));
    const body = (await response.json()) as TokenBody;

    expect(response.status).toBe(200);
    // Credentials must never be cached by an intermediary.
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(15 * 60);
    expect(body.scope).toBe("mcp:read mcp:write");

    const verified = await verifyAccessToken(api.context.signingKey, body.access_token, {
      origin: ORIGIN,
      requiredScope: "mcp:write",
    });
    expect(verified.email).toBe("owner@example.com");
    expect(verified.subject).toBe("google-sub-1");
  });

  it("refuses a second redemption of the same code", async () => {
    const { api, clientId, code, verifier } = await grantedFlow();
    expect((await token(api, codeForm(clientId, code, verifier))).status).toBe(200);

    const replay = await token(api, codeForm(clientId, code, verifier));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({
      error: "invalid_grant",
      error_description: "authorization code already used",
    });
  });

  it("refuses a mismatched PKCE verifier", async () => {
    const { api, clientId, code } = await grantedFlow();
    const response = await token(api, codeForm(clientId, code, "not-the-verifier".padEnd(43, "z")));
    expect(response.status).toBe(400);
    expect((await response.json()) as { error_description: string }).toMatchObject({
      error: "invalid_grant",
      error_description: "PKCE verification failed",
    });
  });

  it("refuses a redirect_uri that is not the one the code was bound to", async () => {
    const { api, clientId, code, verifier } = await grantedFlow();
    const response = await token(api, {
      ...codeForm(clientId, code, verifier),
      redirect_uri: "https://claude.ai/other",
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error_description: string }).toMatchObject({
      error_description: "redirect_uri mismatch",
    });
  });

  it("refuses a client that is not the one the code was issued to", async () => {
    const { api, code, verifier } = await grantedFlow();
    const other = await registerTestClient(api, {
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    });
    const response = await token(api, codeForm(other.clientId, code, verifier));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("requires the secret of a confidential client, and accepts HTTP Basic", async () => {
    const { api, clientId, clientSecret, code, verifier } = await grantedFlow({
      confidential: true,
    });
    expect(clientSecret).toBeTypeOf("string");

    const noSecret = await token(api, codeForm(clientId, code, verifier));
    expect(noSecret.status).toBe(401);

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const withBasic = await token(
      api,
      { grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier },
      { authorization: `Basic ${basic}` },
    );
    expect(withBasic.status).toBe(200);
  });

  it("rejects a wrong secret without saying which half was wrong", async () => {
    const { api, clientId, code, verifier } = await grantedFlow({ confidential: true });
    const basic = Buffer.from(`${clientId}:deadbeef`).toString("base64");
    const response = await token(
      api,
      { grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier },
      { authorization: `Basic ${basic}` },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "invalid_client",
      error_description: "invalid client credentials",
    });
  });

  it("stores no secret and no token in plaintext", async () => {
    const { api, stores, clientId, clientSecret, code, verifier } = await grantedFlow({
      confidential: true,
    });
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = (await (
      await token(
        api,
        { grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier },
        { authorization: `Basic ${basic}` },
      )
    ).json()) as TokenBody;

    const client = stores.clients.rows()[0];
    expect(client?.clientSecretHash).toMatch(/^[0-9a-f]{64}$/);
    const stored = stores.refreshTokens.rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext the client received appears nowhere in the store.
    expect(JSON.stringify(stored)).not.toContain(body.refresh_token);
  });

  it("names a missing parameter rather than failing opaquely", async () => {
    const { api, clientId, code, verifier } = await grantedFlow();
    for (const [field, form] of [
      ["code", { grant_type: "authorization_code", redirect_uri: CALLBACK, code_verifier: verifier }],
      ["redirect_uri", { grant_type: "authorization_code", code, code_verifier: verifier }],
      ["code_verifier", { grant_type: "authorization_code", code, redirect_uri: CALLBACK }],
    ] as const) {
      const response = await token(api, { ...form, client_id: clientId });
      expect(response.status).toBe(400);
      expect((await response.json()) as { error_description: string }).toMatchObject({
        error: "invalid_request",
        error_description: `missing ${field}`,
      });
    }

    const unknownGrant = await token(api, { grant_type: "password", client_id: clientId });
    expect((await unknownGrant.json()) as { error: string }).toMatchObject({
      error: "unsupported_grant_type",
    });
  });
});

describe("refresh_token grant", () => {
  /** Complete the code grant and return the first refresh token. */
  async function withRefreshToken() {
    const flow = await grantedFlow();
    const first = (await (
      await token(flow.api, codeForm(flow.clientId, flow.code, flow.verifier))
    ).json()) as TokenBody;
    return { ...flow, first };
  }

  it("rotates the token and keeps the SAME stable subject", async () => {
    const { api, clientId, first } = await withRefreshToken();
    const response = await token(api, {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    const body = (await response.json()) as TokenBody;

    expect(response.status).toBe(200);
    expect(body.refresh_token).not.toBe(first.refresh_token);
    const verified = await verifyAccessToken(api.context.signingKey, body.access_token, {
      origin: ORIGIN,
    });
    // Without the stored `user_sub` this would fall back to the email and diverge
    // from the initial token, breaking identity correlation after one refresh.
    expect(verified.subject).toBe("google-sub-1");
    expect(verified.email).toBe("owner@example.com");
  });

  it("treats reuse as a replay and revokes the WHOLE lineage", async () => {
    const { api, stores, clientId, first } = await withRefreshToken();
    const second = (await (
      await token(api, {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
        client_id: clientId,
      })
    ).json()) as TokenBody;

    const replay = await token(api, {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(replay.status).toBe(400);
    expect((await replay.json()) as { error: string }).toMatchObject({ error: "invalid_grant" });

    // Every token in the chain is dead — including the one the attacker's victim
    // still holds, which is the point of lineage revocation.
    expect(stores.refreshTokens.rows().every((row) => row.revokedAt !== null)).toBe(true);
    const afterReplay = await token(api, {
      grant_type: "refresh_token",
      refresh_token: second.refresh_token,
      client_id: clientId,
    });
    expect(afterReplay.status).toBe(400);
  });

  it("refuses another client's refresh token and leaves it usable by its owner", async () => {
    const { api, clientId, first } = await withRefreshToken();
    const other = await registerTestClient(api, {
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    });

    const stolen = await token(api, {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: other.clientId,
    });
    expect(stolen.status).toBe(400);
    expect((await stolen.json()) as { error_description: string }).toMatchObject({
      error_description: "refresh token was not issued to this client",
    });

    // The rightful owner is unaffected: the failed attempt neither rotated nor
    // revoked the token, which is why the client check runs BEFORE the replay
    // logic rather than after it.
    const rightful = await token(api, {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(rightful.status).toBe(200);
  });

  it("lets scope narrow and refuses any widening", async () => {
    const { api, clientId, first } = await withRefreshToken();
    const narrowed = (await (
      await token(api, {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
        client_id: clientId,
        scope: "mcp:read",
      })
    ).json()) as TokenBody;
    expect(narrowed.scope).toBe("mcp:read");

    const widened = await token(api, {
      grant_type: "refresh_token",
      refresh_token: narrowed.refresh_token,
      client_id: clientId,
      scope: "mcp:read mcp:write",
    });
    expect(widened.status).toBe(400);
    expect((await widened.json()) as { error: string }).toMatchObject({ error: "invalid_scope" });
  });

  it("refuses an unknown token", async () => {
    const { api, clientId } = await withRefreshToken();
    const response = await token(api, {
      grant_type: "refresh_token",
      refresh_token: "0".repeat(64),
      client_id: clientId,
    });
    expect((await response.json()) as { error_description: string }).toMatchObject({
      error_description: "unknown refresh token",
    });
  });
});

describe("connection liveness", () => {
  it("records the AI host on a grant, attributed from the redirect URIs", async () => {
    const { api, stores, clientId, code, verifier } = await grantedFlow();
    await token(api, codeForm(clientId, code, verifier));

    const rows = stores.connections.rows();
    expect(rows).toHaveLength(1);
    // claude.ai owns the callback → the card that lights up is Claude's.
    expect(rows[0]).toMatchObject({ userId: "user-1", host: "claude", clientName: "Claude" });
  });

  it("never fails a grant when the recording throws", async () => {
    const { api, clientId, code, verifier } = await grantedFlow();
    // A failing directory is the realistic version of this: the token still has to
    // be issued, because liveness is a display concern.
    const brittle = await asHarness({
      connections: {
        resolveUserId: () => {
          throw new Error("directory down");
        },
      },
    });
    const client = await registerTestClient(brittle.api);
    const { verifier: v, challenge } = await pkcePair();
    const brittleCode = codeFrom(
      await authorize(brittle.api, {
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    );
    expect((await token(brittle.api, codeForm(client.clientId, brittleCode, v))).status).toBe(200);
    // And the untouched harness still works, i.e. the throw was contained.
    expect((await token(api, codeForm(clientId, code, verifier))).status).toBe(200);
  });
});
