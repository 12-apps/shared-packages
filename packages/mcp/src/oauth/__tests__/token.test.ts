import { afterEach, describe, expect, it, vi } from "vitest";

import { asHarness, authorize, codeFrom, pkcePair, registerTestClient, token } from "./fixtures";
import { verifyAccessToken } from "../access-token";
import { DEFAULT_ROTATION_GRACE_MS } from "../rotation-grace";
import type { StoredRefreshToken } from "../stores";

/**
 * The token endpoint (12-23) — the port of the origin host's grant suites.
 *
 * Every case is an invariant a reviewer of an AS should insist on: single-use
 * codes, PKCE actually verified, the bound `redirect_uri` re-checked, client
 * authentication for both client types, refresh rotation that revokes the lineage
 * on replay and can only narrow scope, and NOTHING stored in plaintext.
 */

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const ORIGIN = "https://app.example.com";

/** A fixed clock for the cases that step over the rotation grace window. */
const FIXED_NOW = Date.parse("2026-09-10T12:00:00.000Z");

/** Just past the window, where a retry stops being a retry. */
const AFTER_WINDOW = FIXED_NOW + DEFAULT_ROTATION_GRACE_MS + 1_000;

interface TokenBody {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Run the whole happy path and hand back everything a case might assert on. */
async function grantedFlow(options?: {
  scope?: string;
  confidential?: boolean;
  /** AS config overrides — the grace window's cases turn it off or shorten it. */
  as?: Partial<Parameters<typeof asHarness>[0]>;
}) {
  const harness = await asHarness(options?.as ?? {});
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
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Complete the code grant and return the first refresh token. */
  async function withRefreshToken(
    as: Partial<Parameters<typeof asHarness>[0]> = {},
  ) {
    const flow = await grantedFlow({ as });
    const first = (await (
      await token(flow.api, codeForm(flow.clientId, flow.code, flow.verifier))
    ).json()) as TokenBody;
    return { ...flow, first };
  }

  /** The refresh grant's form, which every case below posts. */
  const refreshForm = (
    clientId: string,
    refreshToken: string,
    scope?: string,
  ): Record<string, string> => ({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    ...(scope ? { scope } : {}),
  });

  /** The rows a rotation wrote — every token that has a parent. */
  const successors = (rows: StoredRefreshToken[]): StoredRefreshToken[] =>
    rows.filter((row) => row.rotatedFrom !== null);

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

  it("treats reuse AFTER the grace window as a replay and revokes the WHOLE lineage", async () => {
    // Time is faked from before the grant so the window can be stepped over
    // deterministically; only `Date` is faked, since nothing here awaits a timer.
    vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
    const { api, stores, clientId, first } = await withRefreshToken();
    const second = (await (
      await token(api, refreshForm(clientId, first.refresh_token))
    ).json()) as TokenBody;

    // Past the window, the retry excuse is gone and reuse is what it looks like.
    vi.setSystemTime(AFTER_WINDOW);

    const replay = await token(api, refreshForm(clientId, first.refresh_token));
    expect(replay.status).toBe(400);
    expect((await replay.json()) as { error: string }).toMatchObject({ error: "invalid_grant" });

    // Every token in the chain is dead — including the one the attacker's victim
    // still holds, which is the point of lineage revocation.
    expect(stores.refreshTokens.rows().every((row) => row.revokedAt !== null)).toBe(true);
    const afterReplay = await token(api, refreshForm(clientId, second.refresh_token));
    expect(afterReplay.status).toBe(400);
  });

  it("answers a retry INSIDE the grace window with the very same successor", async () => {
    const { api, stores, clientId, first } = await withRefreshToken();
    const rotated = (await (
      await token(api, refreshForm(clientId, first.refresh_token))
    ).json()) as TokenBody;

    // The 200 never reached the client — a proxy timeout, a dropped connection —
    // so it retries with the only token it still holds: the consumed one.
    const retry = await token(api, refreshForm(clientId, first.refresh_token));
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as TokenBody;

    // The SAME token comes back. Minting a second one here is the thing that must
    // never happen: it would leave one parent with two live successors and two
    // independently rotating families, which is the state replay protection exists
    // to prevent.
    expect(body.refresh_token).toBe(rotated.refresh_token);
    expect(successors(stores.refreshTokens.rows())).toHaveLength(1);
    // And nothing was revoked to pay for it, so the connection survives.
    expect(successors(stores.refreshTokens.rows())[0]?.revokedAt).toBeNull();

    // The successor is still the live token, and rotating it works normally.
    const next = await token(api, refreshForm(clientId, body.refresh_token));
    expect(next.status).toBe(200);
  });

  it("hands CONCURRENT rotations of one token the SAME successor, writing one", async () => {
    const { api, stores, clientId, first } = await withRefreshToken();
    const refresh = () => token(api, refreshForm(clientId, first.refresh_token));

    // The validate-then-write in `rotateRefreshToken` is a READ, so both of these
    // pass their checks; `store.rotate` is the serialization point and its
    // claim-once write is what decides between them. That claim is the invariant
    // replay protection rests on and it is unchanged — what changed is what the
    // LOSER is told. It used to be the replay answer, which revoked the lineage
    // including the successor just handed to the winner, so one client refreshing
    // from two of its own sessions destroyed its own connection.
    const responses = await Promise.all([refresh(), refresh()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);

    const bodies = (await Promise.all(
      responses.map((response) => response.json()),
    )) as TokenBody[];
    // Both callers hold one token, not two families.
    expect(bodies[0]?.refresh_token).toBe(bodies[1]?.refresh_token);
    // Exactly one successor was ever written. Two rows would mean the claim leaked.
    expect(successors(stores.refreshTokens.rows())).toHaveLength(1);
    expect(successors(stores.refreshTokens.rows())[0]?.revokedAt).toBeNull();
  });

  it("keeps the STRICT single-use rule when the window is turned off", async () => {
    // The window is operator-tunable, and 0 must restore exactly the behaviour
    // that predates it — otherwise there is no way back to the strict rule.
    const { api, stores, clientId, first } = await withRefreshToken({
      refreshRotationGraceMs: 0,
    });
    const refresh = () => token(api, refreshForm(clientId, first.refresh_token));

    const statuses = (await Promise.all([refresh(), refresh()]))
      .map((response) => response.status)
      .sort();
    expect(statuses).toEqual([200, 400]);
    expect(stores.refreshTokens.rows().every((row) => row.revokedAt !== null)).toBe(true);
    expect(successors(stores.refreshTokens.rows())).toHaveLength(1);
    // Nothing was sealed either, so the strict rule stores no extra material.
    expect(successors(stores.refreshTokens.rows())[0]?.graceSeal ?? null).toBeNull();
  });

  it("never resurrects a lineage a real replay already revoked", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
    const { api, stores, clientId, first } = await withRefreshToken();
    await token(api, refreshForm(clientId, first.refresh_token));

    // A genuine replay, past the window, kills the family.
    vi.setSystemTime(AFTER_WINDOW);
    expect((await token(api, refreshForm(clientId, first.refresh_token))).status).toBe(400);
    expect(stores.refreshTokens.rows().every((row) => row.revokedAt !== null)).toBe(true);

    // Winding the clock back inside a fresh window must not bring it back: grace
    // checks the successor is UNREVOKED, not merely that a seal opens.
    vi.setSystemTime(FIXED_NOW);
    expect((await token(api, refreshForm(clientId, first.refresh_token))).status).toBe(400);
  });

  it("refuses a retry that asks for different scopes WITHOUT killing the lineage", async () => {
    const { api, stores, clientId, first } = await withRefreshToken();
    const rotated = (await (
      await token(api, refreshForm(clientId, first.refresh_token))
    ).json()) as TokenBody;

    // A retry repeats its original request. A different scope set is a NEW
    // decision, and answering it with the token minted for the old one would
    // silently ignore what was asked. So it is refused —
    const narrowed = await token(api, refreshForm(clientId, first.refresh_token, "mcp:read"));
    expect(narrowed.status).toBe(400);
    expect((await narrowed.json()) as { error: string }).toMatchObject({
      error: "invalid_scope",
    });

    // — but NOT as a replay. Revoking the family here would destroy a live
    // session over exactly the innocent double-use this window exists to
    // forgive, which is the bug wearing a different hat.
    expect(successors(stores.refreshTokens.rows())[0]?.revokedAt).toBeNull();
    const still = await token(api, refreshForm(clientId, rotated.refresh_token));
    expect(still.status).toBe(200);
  });

  it("stores no token plaintext, sealed or otherwise", async () => {
    const { api, stores, clientId, first } = await withRefreshToken();
    const rotated = (await (
      await token(api, refreshForm(clientId, first.refresh_token))
    ).json()) as TokenBody;

    // The seal is the one place a successor's plaintext could leak into the
    // table, and it must not: it is AEAD ciphertext under a key derived from the
    // parent, which is itself never stored.
    const dumped = JSON.stringify(stores.refreshTokens.rows());
    expect(dumped).not.toContain(rotated.refresh_token);
    expect(dumped).not.toContain(first.refresh_token);
    expect(successors(stores.refreshTokens.rows())[0]?.graceSeal).toEqual(expect.any(String));
  });

  it("clears a consumed token's seal, so spent plaintext plus the table opens nothing", async () => {
    // THE bound on what the seal costs. A seal is openable by the plaintext it
    // was sealed under and by nothing else — but if spent seals stayed, they
    // would CHAIN: one historical plaintext plus a copy of this table walks
    // forward hop by hop to the live token, entirely offline, with no server
    // call and therefore no replay detection. Clearing the parent's seal as it
    // is consumed means at most one hop is ever open.
    const { api, stores, clientId, first } = await withRefreshToken();
    const second = (await (
      await token(api, refreshForm(clientId, first.refresh_token))
    ).json()) as TokenBody;
    // Rotate once more, so the middle token becomes a SPENT one.
    await token(api, refreshForm(clientId, second.refresh_token));

    const rows = stores.refreshTokens.rows();
    const spent = rows.filter((row) => row.revokedAt !== null);
    expect(spent.length).toBeGreaterThan(0);
    expect(spent.every((row) => (row.graceSeal ?? null) === null)).toBe(true);
    // Exactly one row still carries a seal: the live token's.
    expect(rows.filter((row) => row.graceSeal)).toHaveLength(1);
  });

  it("leaves no openable seal behind a revoked lineage", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
    const { api, stores, clientId, first } = await withRefreshToken();
    await token(api, refreshForm(clientId, first.refresh_token));

    vi.setSystemTime(AFTER_WINDOW);
    expect((await token(api, refreshForm(clientId, first.refresh_token))).status).toBe(400);

    // Revocation that leaves the chain readable would be cosmetic.
    expect(stores.refreshTokens.rows().every((row) => (row.graceSeal ?? null) === null)).toBe(
      true,
    );
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
