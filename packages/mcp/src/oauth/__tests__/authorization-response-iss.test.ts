import { describe, expect, it } from "vitest";

import { inProcessConsentReplayStore } from "../consent-ticket";
import { asHarness, authorize, pkcePair, registerTestClient } from "./fixtures";

/**
 * RFC 9207 (FUT-4523): every authorization response names its issuer, success
 * and error alike, so a client talking to several authorization servers can tell
 * which one answered (the mix-up defence). The Client ID Metadata Documents draft
 * makes it a MUST for a server that accepts metadata-document clients (§7).
 */

const ORIGIN = "https://app.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

type Harness = Awaited<ReturnType<typeof asHarness>>;

async function validQuery(clientId: string): Promise<Record<string, string>> {
  const { challenge } = await pkcePair();
  return {
    response_type: "code", client_id: clientId, redirect_uri: CALLBACK,
    code_challenge: challenge, code_challenge_method: "S256", scope: "mcp:read", state: "st-1",
  };
}

function callbackOf(location: string | null): URL {
  if (!location) throw new Error("no redirect");
  return new URL(location);
}

async function harnessWithClient(overrides: Parameters<typeof asHarness>[0] = {}) {
  const harness = await asHarness(overrides);
  const { clientId } = await registerTestClient(harness.api);
  return { ...harness, clientId, query: await validQuery(clientId) };
}

async function metadataIssuer(api: Harness["api"], request: Request): Promise<string> {
  const response = await api.handlers.authorizationServerMetadata(request);
  return ((await response.json()) as { issuer: string }).issuer;
}

describe("iss on the authorize endpoint's redirects", () => {
  it("names the issuer on a minted code, next to the code and the state", async () => {
    const { api, query } = await harnessWithClient();
    const location = callbackOf((await authorize(api, query)).headers.get("location"));
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("st-1");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });

  it.each([
    ["unsupported_response_type", { response_type: "token" }],
    ["invalid_request", { code_challenge_method: "plain" }],
    ["invalid_scope", { scope: "mcp:admin" }],
    ["invalid_request", { resource: "https://elsewhere.example.com/api/mcp" }],
  ])("names the issuer on %s", async (error, change) => {
    const { api, query } = await harnessWithClient();
    const location = callbackOf((await authorize(api, { ...query, ...change })).headers.get("location"));
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("state")).toBe("st-1");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("names the issuer on access_denied, with or without a consent screen", async () => {
    const refused = await harnessWithClient({ resolveApproval: () => false });
    const screened = await harnessWithClient({
      resolveApproval: () => false,
      consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore(), requireClientApproval: true },
    });
    for (const { api, query } of [refused, screened]) {
      const location = callbackOf((await authorize(api, query)).headers.get("location"));
      expect(location.searchParams.get("error")).toBe("access_denied");
      expect(location.searchParams.get("iss")).toBe(ORIGIN);
    }
  });

  it("names the issuer on server_error when no signing key is provisioned", async () => {
    const { api, query } = await harnessWithClient({ signingKey: async () => null });
    const location = callbackOf((await authorize(api, query)).headers.get("location"));
    expect(location.searchParams.get("error")).toBe("server_error");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("omits nothing else and keeps the callback's own query", async () => {
    const harness = await asHarness();
    const withQuery = `${CALLBACK}?existing=a%2Bb`;
    const { clientId } = await registerTestClient(harness.api, { redirect_uris: [withQuery] });
    const query = { ...(await validQuery(clientId)), redirect_uri: withQuery };
    const location = callbackOf((await authorize(harness.api, query)).headers.get("location"));
    expect(location.searchParams.get("existing")).toBe("a+b");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("is the trusted origin's issuer, the one the metadata serves, never a forwarded host", async () => {
    const { api, query } = await harnessWithClient({ trustedOrigins: ["https://public.example.com"] });
    const headers = { "x-forwarded-host": "evil.example.com", "x-forwarded-proto": "https" };
    const url = new URL(`${ORIGIN}/api/oauth/authorize?${new URLSearchParams(query)}`);
    const response = await api.handlers.authorize(new Request(url, { headers }));
    const served = await metadataIssuer(api, new Request(`${ORIGIN}/.well-known/oauth-authorization-server`, { headers }));
    expect(served).toBe("https://public.example.com");
    expect(callbackOf(response.headers.get("location")).searchParams.get("iss")).toBe(served);
  });

  it("is never sent to an unvalidated callback: a refusal there stays a plain 400", async () => {
    const { api, query } = await harnessWithClient();
    const response = await authorize(api, { ...query, redirect_uri: `${CALLBACK}/evil` });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("iss on the consent decision's redirectUrl", () => {
  async function decided(decision: "approve" | "deny"): Promise<URL> {
    const { api, query, session } = await harnessWithClient({
      consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore() },
    });
    session.current = { subject: "google-sub-1", email: "owner@example.com", sessionBinding: "cookie-session-one" };
    const ticket = callbackOf((await authorize(api, query)).headers.get("location")).searchParams.get("request") ?? "";
    const result = await api.handlers.consentDecision(new Request(`${ORIGIN}/api/oauth/consent`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ request: ticket, decision }),
    }));
    return new URL(((await result.json()) as { redirectUrl: string }).redirectUrl);
  }

  it("names the issuer on an approval", async () => {
    const location = await decided("approve");
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("names the issuer on a denial", async () => {
    const location = await decided("deny");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
  });
});
