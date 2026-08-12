import { describe, expect, it } from "vitest";

import { asHarness, authorize, codeFrom, pkcePair, registerTestClient } from "./fixtures";
import { verifyCode } from "../authorization-code";
import { verifyAccessToken } from "../access-token";
import { testSigningKey } from "./fixtures";

/**
 * The authorization endpoint (12-23) — ported from future-pay's own suite, because
 * every case here is a security property rather than a behaviour preference:
 *
 *  - an error is NEVER redirected to an unvalidated `redirect_uri`;
 *  - PKCE S256 is mandatory and `plain` is refused;
 *  - a client cannot request a scope it did not register for;
 *  - the identity in the code comes from the SESSION, never from the query;
 *  - an unprovisioned signing key mints nothing.
 */

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

describe("open-redirect guard", () => {
  it("400s in plain text when the client or redirect_uri is not registered", async () => {
    const { api } = await asHarness();
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();

    for (const params of [
      { response_type: "code", redirect_uri: CALLBACK, code_challenge: challenge },
      { response_type: "code", client_id: clientId, code_challenge: challenge },
      { response_type: "code", client_id: "unknown", redirect_uri: CALLBACK },
      {
        response_type: "code",
        client_id: clientId,
        // Registered value plus a path — an EXACT match is the only match.
        redirect_uri: `${CALLBACK}/evil`,
      },
    ]) {
      const response = await authorize(api, params as Record<string, string>);
      expect(response.status).toBe(400);
      // No Location: an error must never be steered to an unvalidated URI.
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("content-type")).toContain("text/plain");
    }
  });
});

describe("request validation, once the redirect_uri is trusted", () => {
  it("redirects unsupported_response_type back to the client with the state echoed", async () => {
    const { api } = await asHarness();
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();

    const response = await authorize(api, {
      response_type: "token",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "abc123",
    });
    const location = new URL(String(response.headers.get("location")));
    expect(response.status).toBe(302);
    expect(location.searchParams.get("error")).toBe("unsupported_response_type");
    expect(location.searchParams.get("state")).toBe("abc123");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("refuses a missing challenge and every non-S256 method, including plain", async () => {
    const { api } = await asHarness();
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();

    for (const pkce of [
      {},
      { code_challenge: challenge },
      { code_challenge: challenge, code_challenge_method: "plain" },
      { code_challenge: challenge, code_challenge_method: "S512" },
    ]) {
      const response = await authorize(api, {
        response_type: "code",
        client_id: clientId,
        redirect_uri: CALLBACK,
        ...pkce,
      });
      const location = new URL(String(response.headers.get("location")));
      // `plain` offers no protection against an intercepted code, which is the
      // exact threat PKCE exists to close — so it is an error, never a fallback.
      expect(location.searchParams.get("error")).toBe("invalid_request");
    }
  });

  it("refuses a scope the CLIENT did not register for", async () => {
    const { api } = await asHarness();
    // Registered read-only: the DCR grant is a ceiling, enforced here rather than
    // trusted at registration time.
    const { clientId } = await registerTestClient(api, { scope: "mcp:read" });
    const { challenge } = await pkcePair();

    const response = await authorize(api, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "mcp:read mcp:write",
    });
    expect(new URL(String(response.headers.get("location"))).searchParams.get("error")).toBe(
      "invalid_scope",
    );
  });
});

describe("identity and minting", () => {
  it("sends an unauthenticated caller to sign-in and mints nothing", async () => {
    const { api, session } = await asHarness();
    session.current = null;
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();

    const response = await authorize(api, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "s",
    });
    const location = new URL(String(response.headers.get("location")));
    expect(location.pathname).toBe("/login");
    // The callback returns to THIS authorize URL, so the flow resumes post-login.
    expect(location.searchParams.get("callbackUrl")).toContain("/api/oauth/authorize");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("binds the SESSION identity into the code, not anything from the query", async () => {
    const { api, session } = await asHarness();
    session.current = { subject: "google-sub-9", email: "owner@example.com" };
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();

    const response = await authorize(api, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "mcp:read",
      state: "keepme",
      // A client trying to choose the identity. It must be ignored entirely.
      email: "victim@example.com",
      sub: "victim-sub",
    });

    const location = new URL(String(response.headers.get("location")));
    expect(location.searchParams.get("state")).toBe("keepme");
    const verified = await verifyCode(api.context.signingKey, codeFrom(response), {
      origin: "https://app.example.com",
    });
    expect(verified.email).toBe("owner@example.com");
    expect(verified.sub).toBe("google-sub-9");
    expect(verified.clientId).toBe(clientId);
    expect(verified.codeChallenge).toBe(challenge);
  });

  it("server_errors rather than minting when no signing key is provisioned", async () => {
    const { api } = await asHarness({ signingKey: async () => null });
    // Registration itself needs no key, so a client can exist while the AS cannot
    // sign — the safe-by-default path this asserts.
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();

    const response = await authorize(api, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(new URL(String(response.headers.get("location"))).searchParams.get("error")).toBe(
      "server_error",
    );
  });

  it("mints a code that cannot be presented as an access token", async () => {
    const { api } = await asHarness();
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();
    const code = codeFrom(
      await authorize(api, {
        response_type: "code",
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    );

    // The code's audience is `oauth:code`; the resource server pins the MCP
    // resource URL. Each rejects the other's blobs — which is what stops a code
    // intercepted on the redirect from being used as a bearer token.
    await expect(
      verifyAccessToken(api.context.signingKey, code, { origin: "https://app.example.com" }),
    ).rejects.toThrow(/verification failed/);
  });

  it("rejects a code signed by another deployment's key", async () => {
    const { api } = await asHarness();
    const { clientId } = await registerTestClient(api);
    const { challenge } = await pkcePair();
    const code = codeFrom(
      await authorize(api, {
        response_type: "code",
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    );

    const foreignKey = await testSigningKey();
    await expect(
      verifyCode(foreignKey, code, { origin: "https://app.example.com" }),
    ).rejects.toThrow(/verification failed/);
  });
});
