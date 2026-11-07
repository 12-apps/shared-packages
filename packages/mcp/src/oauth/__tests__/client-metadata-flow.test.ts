import { describe, expect, it } from "vitest";

import type { FetchMetadataDocument, MetadataDocumentAnswer } from "../client-metadata";
import { inProcessConsentReplayStore } from "../consent-ticket";
import { asHarness, authorize, codeFrom, pkcePair, token } from "./fixtures";

/**
 * A client identified by a metadata-document URL, end to end through the surface
 * (FUT-4522): the discovery document says it is supported, `authorize` mints a
 * code for it, `token` redeems and refreshes it, the connection is attributed
 * from the document — and nothing of it is written to the client store.
 */

const CLAUDE_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_DOCUMENT = {
  client_id: CLAUDE_ID,
  client_name: "Claude",
  client_uri: "https://claude.ai",
  redirect_uris: [CALLBACK],
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};
const CODE_ID = "https://claude.ai/oauth/claude-code-client-metadata";
const CODE_DOCUMENT = {
  client_id: CODE_ID,
  client_name: "Claude Code",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

function serving(documents: Record<string, unknown>): FetchMetadataDocument & { calls: string[] } {
  const transport = (async (url: URL): Promise<MetadataDocumentAnswer> => {
    transport.calls.push(url.href);
    const document = documents[url.href];
    if (document instanceof Error) throw document;
    if (document === undefined) return { status: 404, body: "Not Found" };
    return { status: 200, body: JSON.stringify(document) };
  }) as FetchMetadataDocument & { calls: string[] };
  transport.calls = [];
  return transport;
}

async function cimdHarness(documents: Record<string, unknown> = { [CLAUDE_ID]: CLAUDE_DOCUMENT }) {
  const transport = serving(documents);
  const refusals: Array<[string, string]> = [];
  const harness = await asHarness({
    clientIdMetadataDocuments: { fetchDocument: transport },
    onClientMetadataRefusal: (clientId, reason) => refusals.push([clientId, reason]),
  });
  return { ...harness, transport, refusals };
}

async function authorizeFor(
  api: Awaited<ReturnType<typeof asHarness>>["api"],
  clientId: string,
  redirectUri = CALLBACK,
) {
  const { verifier, challenge } = await pkcePair();
  const authorized = await authorize(api, {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mcp:read mcp:write",
    state: "s1",
    resource: "https://app.example.com/api/mcp",
  });
  return { response: authorized, verifier };
}

describe("discovery", () => {
  it("advertises client_id_metadata_document_supported when the host turns it on", async () => {
    const { api } = await cimdHarness();
    const advertised = await api.handlers.authorizationServerMetadata(
      new Request("https://app.example.com/.well-known/oauth-authorization-server"),
    );
    expect(await advertised.json()).toMatchObject({ client_id_metadata_document_supported: true });
  });

  it("says nothing of it when the host leaves it off", async () => {
    const { api } = await asHarness();
    const silent = await api.handlers.authorizationServerMetadata(
      new Request("https://app.example.com/.well-known/oauth-authorization-server"),
    );
    expect(await silent.json()).not.toHaveProperty("client_id_metadata_document_supported");
  });
});

describe("a metadata-document client", () => {
  it("is issued a code, redeems it and refreshes it, with nothing written to the client store", async () => {
    const { api, stores } = await cimdHarness();
    const { response, verifier } = await authorizeFor(api, CLAUDE_ID);
    expect(response.status).toBe(302);
    expect(new URL(String(response.headers.get("location"))).origin).toBe("https://claude.ai");

    const granted = await token(api, {
      grant_type: "authorization_code",
      code: codeFrom(response),
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      client_id: CLAUDE_ID,
    });
    expect(granted.status).toBe(200);
    const body = (await granted.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(body.access_token).toBeTruthy();
    expect(body.scope).toBe("mcp:read mcp:write");

    const refreshed = await token(api, {
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
      client_id: CLAUDE_ID,
    });
    expect(refreshed.status).toBe(200);

    expect(stores.clients.rows()).toEqual([]);
    expect(stores.refreshTokens.rows().every((row) => row.clientId === CLAUDE_ID)).toBe(true);
  });

  it("records the connection with the document's name and the provider of its callback", async () => {
    const { api, stores } = await cimdHarness();
    const { response, verifier } = await authorizeFor(api, CLAUDE_ID);
    await token(api, {
      grant_type: "authorization_code",
      code: codeFrom(response),
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      client_id: CLAUDE_ID,
    });
    expect(stores.connections.rows()).toMatchObject([
      { oauthClientId: CLAUDE_ID, clientName: "Claude", host: "claude" },
    ]);
  });

  it("shares one fetch across authorize, the code grant and the refresh", async () => {
    const { api, transport } = await cimdHarness();
    const { response, verifier } = await authorizeFor(api, CLAUDE_ID);
    const granted = await token(api, {
      grant_type: "authorization_code",
      code: codeFrom(response),
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      client_id: CLAUDE_ID,
    });
    const { refresh_token } = (await granted.json()) as { refresh_token: string };
    await token(api, { grant_type: "refresh_token", refresh_token, client_id: CLAUDE_ID });
    expect(transport.calls).toEqual([CLAUDE_ID]);
  });

  it("refuses a token request that presents a client credential, in the body or as Basic", async () => {
    const { api } = await cimdHarness();
    const basic = `Basic ${Buffer.from(`${encodeURIComponent(CLAUDE_ID)}:secret`).toString("base64")}`;
    for (const [form, headers] of [
      [{ client_id: CLAUDE_ID, client_secret: "secret" }, {}],
      [{ client_id: CLAUDE_ID, client_assertion: "eyJ.x.y", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" }, {}],
      [{}, { authorization: basic }],
    ] as const) {
      const { response, verifier } = await authorizeFor(api, CLAUDE_ID);
      const refused = await token(api, {
        grant_type: "authorization_code",
        code: codeFrom(response),
        redirect_uri: CALLBACK,
        code_verifier: verifier,
        ...form,
      }, headers);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: "invalid_client" });
    }
    // The body case reaches the document rule itself (the Basic one is refused
    // a step earlier, on its undecoded client id); prove it is that rule.
    const { response, verifier } = await authorizeFor(api, CLAUDE_ID);
    const withSecret = await token(api, {
      grant_type: "authorization_code",
      code: codeFrom(response),
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      client_id: CLAUDE_ID,
      client_secret: "secret",
    });
    expect(await withSecret.json()).toMatchObject({
      error_description: "client authentication is not accepted for this client",
    });
  });

  it("accepts a loopback callback on any port when the document lists it without one", async () => {
    const { api } = await cimdHarness({ [CODE_ID]: CODE_DOCUMENT });
    const { response, verifier } = await authorizeFor(api, CODE_ID, "http://localhost:61234/callback");
    expect(response.status).toBe(302);
    const granted = await token(api, {
      grant_type: "authorization_code",
      code: codeFrom(response),
      redirect_uri: "http://localhost:61234/callback",
      code_verifier: verifier,
      client_id: CODE_ID,
    });
    expect(granted.status).toBe(200);
  });

  it("refuses a callback the document does not list, in plain text and without a redirect", async () => {
    const { api } = await cimdHarness();
    const { response } = await authorizeFor(api, CLAUDE_ID, "https://evil.example/callback");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("redirect_uri is not registered");
  });

  it("refuses a document that names another client, and tells the host why", async () => {
    const { api, refusals } = await cimdHarness({ [CLAUDE_ID]: { ...CLAUDE_DOCUMENT, client_id: "https://evil.example/x" } });
    const { response } = await authorizeFor(api, CLAUDE_ID);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("unknown client_id");
    expect(refusals).toEqual([[CLAUDE_ID, "document client_id does not match its URL"]]);
  });

  it("answers 503 at authorize and token, never invalid_client, while the document cannot be fetched", async () => {
    const { api } = await cimdHarness({ [CLAUDE_ID]: new Error("ECONNRESET") });
    const { response } = await authorizeFor(api, CLAUDE_ID);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("location")).toBeNull();

    const refreshed = await token(api, { grant_type: "refresh_token", refresh_token: "r", client_id: CLAUDE_ID });
    expect(refreshed.status).toBe(503);
    expect(await refreshed.json()).toMatchObject({ error: "server_error" });
  });

  it("stays unknown when the host has not turned the feature on", async () => {
    const { api } = await asHarness();
    const { response } = await authorizeFor(api, CLAUDE_ID);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("unknown client_id");
  });

  it("leaves a registered client exactly as it was, with no fetch", async () => {
    const { api, transport } = await cimdHarness();
    const registered = await api.handlers.register(
      new Request("https://app.example.com/api/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: "Claude" }),
      }),
    );
    const { client_id } = (await registered.json()) as { client_id: string };
    const { response } = await authorizeFor(api, client_id);
    expect(response.status).toBe(302);
    // The loopback leniency is the document's alone: a registered client keeps the exact match.
    const loose = await authorizeFor(api, client_id, "http://localhost:1/api/mcp/auth_callback");
    expect(loose.response.status).toBe(400);
    expect(transport.calls).toEqual([]);
  });
});

describe("a metadata-document client at the consent screen", () => {
  async function consentHarness(documents: Record<string, unknown>) {
    const transport = serving(documents);
    const harness = await asHarness({
      consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore() },
      // No reuse: every lookup refetches, so the consent step's own lookup is exercised.
      clientIdMetadataDocuments: { fetchDocument: transport, cacheTtlMs: 0, staleIfErrorMs: 0 },
    });
    harness.session.current = { subject: "google-sub-1", email: "owner@example.com", sessionBinding: "cookie-session-one" };
    return { ...harness, transport, documents };
  }

  function ticketOf(response: Response): string {
    return new URL(String(response.headers.get("location"))).searchParams.get("request") ?? "";
  }

  it("names the document's client and is approved back to its callback, loopback port included", async () => {
    const { api } = await consentHarness({ [CODE_ID]: CODE_DOCUMENT });
    const { response } = await authorizeFor(api, CODE_ID, "http://localhost:61234/callback");
    const ticket = ticketOf(response);
    const details = await api.handlers.consentDetails(
      new Request(`https://app.example.com/api/oauth/consent?${new URLSearchParams({ request: ticket })}`),
    );
    expect(await details.json()).toMatchObject({ clientName: "Claude Code", redirectUri: "http://localhost:61234/callback" });
    const decided = await api.handlers.consentDecision(new Request("https://app.example.com/api/oauth/consent", {
      method: "POST",
      headers: { origin: "https://app.example.com", "content-type": "application/json" },
      body: JSON.stringify({ request: ticket, decision: "approve" }),
    }));
    const { redirectUrl } = (await decided.json()) as { redirectUrl: string };
    expect(new URL(redirectUrl).searchParams.get("code")).toBeTruthy();
  });

  it("answers 503 temporarily_unavailable at both consent endpoints while the document cannot be fetched", async () => {
    const { api, documents } = await consentHarness({ [CLAUDE_ID]: CLAUDE_DOCUMENT });
    const { response } = await authorizeFor(api, CLAUDE_ID);
    const ticket = ticketOf(response);
    documents[CLAUDE_ID] = new Error("ECONNRESET");
    for (const answer of [
      await api.handlers.consentDetails(
        new Request(`https://app.example.com/api/oauth/consent?${new URLSearchParams({ request: ticket })}`),
      ),
      await api.handlers.consentDecision(new Request("https://app.example.com/api/oauth/consent", {
        method: "POST",
        headers: { origin: "https://app.example.com", "content-type": "application/json" },
        body: JSON.stringify({ request: ticket, decision: "approve" }),
      })),
    ]) {
      expect(answer.status).toBe(503);
      expect(answer.headers.get("retry-after")).toBe("30");
      expect(await answer.json()).toEqual({ error: "temporarily_unavailable" });
    }
  });
});
