import { describe, expect, it } from "vitest";

import {
  ClientMetadataDocumentError,
  ClientMetadataUnavailableError,
  clientFromMetadataDocument,
  createClientMetadataDocumentResolver,
  fetchMetadataDocument,
  isClientIdMetadataUrl,
  isNonPublicAddress,
  matchesLoopbackRedirectUri,
  parseClientIdMetadataUrl,
  type FetchMetadataDocument,
  type MetadataDocumentAnswer,
} from "../client-metadata";

/**
 * OAuth Client ID Metadata Documents (FUT-4522): the URL rules, the address
 * refusal, the document rules and the cache — each case a rule of
 * draft-ietf-oauth-client-id-metadata-document or a bound on the fetch an
 * unauthenticated `authorize` can trigger.
 */

const CLAUDE_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const SCOPES = ["mcp:read", "mcp:write"] as const;

/** Claude's published document, byte for byte as served on 2026-11-06. */
const CLAUDE_DOCUMENT = {
  client_id: CLAUDE_ID,
  client_name: "Claude",
  client_uri: "https://claude.ai",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

function answer(body: unknown, status = 200, cacheControl?: string): MetadataDocumentAnswer {
  return {
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(cacheControl ? { cacheControl } : {}),
  };
}

/** A transport that replays `answers` in order and counts its calls. */
function scripted(...answers: Array<MetadataDocumentAnswer | Error>): FetchMetadataDocument & { calls: number } {
  const transport = (async () => {
    transport.calls += 1;
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    if (!next) throw new Error("no scripted answer");
    return next;
  }) as FetchMetadataDocument & { calls: number };
  transport.calls = 0;
  return transport;
}

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  const times = [start];
  return {
    now: () => times.at(-1) ?? start,
    advance: (ms) => times.push((times.at(-1) ?? start) + ms),
  };
}

describe("the client_id URL", () => {
  it("is told apart from a registered id by its scheme", () => {
    expect(isClientIdMetadataUrl(CLAUDE_ID)).toBe(true);
    expect(isClientIdMetadataUrl("2f1c3a8e-1d2b-4c5d-9e8f-0a1b2c3d4e5f")).toBe(false);
    expect(isClientIdMetadataUrl("http://claude.ai/oauth/x")).toBe(false);
  });

  it("accepts Claude's own client_id", () => {
    expect(parseClientIdMetadataUrl(CLAUDE_ID).hostname).toBe("claude.ai");
  });

  it.each([
    ["http://claude.ai/oauth/x", "not https"],
    ["https://claude.ai", "no path"],
    ["https://claude.ai/", "no path"],
    ["https://user:pass@claude.ai/oauth/x", "credentials"],
    ["https://claude.ai/oauth/x#frag", "fragment"],
    ["https://claude.ai/oauth/../x", "dot segment"],
    ["https://claude.ai/./x", "dot segment"],
    ["https://127.0.0.1/x", "IP address"],
    ["https://[::1]/x", "IP address"],
    ["https://CLAUDE.ai/oauth/x", "canonical"],
    ["https://claude.ai:443/oauth/x", "canonical"],
    ["not a url", "not a URL"],
  ])("refuses %s (%s)", (clientId, rule) => {
    expect(() => parseClientIdMetadataUrl(clientId)).toThrow(ClientMetadataDocumentError);
    expect(() => parseClientIdMetadataUrl(clientId)).toThrow(new RegExp(rule));
  });
});

describe("the destination address", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "64:ff9b::a00:1", "2001:db8::1", "2002:a00:1::1", "2001:0:4136:e378::1", "2001::1", "100::1", "2001:2::1", "2001:10::1", "2001:1ff::1",
    "::ffff:7f00:1", "::ffff:a00:1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "192.88.99.1", "240.0.0.1",
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(["160.79.104.10", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::6810:1", "::ffff:8.8.8.8", "::ffff:808:808", "2001:4860:4860::8888", "2001:200::1"])(
    "allows the public address %s",
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false);
    },
  );

  it("refuses at connect time a host that resolves to loopback", async () => {
    await expect(
      fetchMetadataDocument(new URL("https://localhost/oauth/client"), { timeoutMs: 2000, maxBytes: 1024 }),
    ).rejects.toThrow(/non-public address/);
  });
});

describe("the document", () => {
  it("becomes a public client with the server's scopes, keeping only the grants it serves", () => {
    const client = clientFromMetadataDocument(CLAUDE_ID, CLAUDE_DOCUMENT, SCOPES);
    expect(client).toEqual({
      clientId: CLAUDE_ID,
      clientSecretHash: null,
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      clientName: "Claude",
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      scopes: ["mcp:read", "mcp:write"],
    });
  });

  it("chooses none from an auth-methods list that offers it, whatever single method is named", () => {
    const client = clientFromMetadataDocument(
      CLAUDE_ID,
      { ...CLAUDE_DOCUMENT, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["none", "private_key_jwt"] },
      SCOPES,
    );
    expect(client.tokenEndpointAuthMethod).toBe("none");
  });

  it("narrows the scopes to the ones a document asks for, never widens them", () => {
    const client = clientFromMetadataDocument(CLAUDE_ID, { ...CLAUDE_DOCUMENT, scope: "mcp:read admin:all" }, SCOPES);
    expect(client.scopes).toEqual(["mcp:read"]);
  });

  it("keeps a missing name as null and caps a long one", () => {
    const nameless: Record<string, unknown> = { ...CLAUDE_DOCUMENT };
    delete nameless.client_name;
    expect(clientFromMetadataDocument(CLAUDE_ID, nameless, SCOPES).clientName).toBeNull();
    const long = clientFromMetadataDocument(CLAUDE_ID, { ...CLAUDE_DOCUMENT, client_name: "x".repeat(500) }, SCOPES);
    expect(long.clientName).toHaveLength(200);
  });

  it.each([
    ["not an object", [], /not a JSON object/],
    ["a client_id that is another URL", { ...CLAUDE_DOCUMENT, client_id: "https://evil.example/oauth/x" }, /does not match/],
    ["a confidential auth method", { ...CLAUDE_DOCUMENT, token_endpoint_auth_method: "client_secret_basic" }, /token_endpoint_auth_method/],
    ["private_key_jwt", { ...CLAUDE_DOCUMENT, token_endpoint_auth_method: "private_key_jwt" }, /token_endpoint_auth_method/],
    ["a client secret", { ...CLAUDE_DOCUMENT, client_secret: "s" }, /client secret/],
    ["no redirect_uris", { ...CLAUDE_DOCUMENT, redirect_uris: [] }, /redirect_uris/],
    ["a relative redirect_uri", { ...CLAUDE_DOCUMENT, redirect_uris: ["/callback"] }, /redirect_uris/],
    ["a non-web redirect_uri", { ...CLAUDE_DOCUMENT, redirect_uris: ["javascript:alert(1)"] }, /redirect_uris/],
    ["no authorization_code grant", { ...CLAUDE_DOCUMENT, grant_types: ["client_credentials"] }, /authorization_code/],
    ["no code response type", { ...CLAUDE_DOCUMENT, response_types: ["token"] }, /response_type code/],
    ["grant_types that is not a list", { ...CLAUDE_DOCUMENT, grant_types: "authorization_code" }, /grant_types is not a list/],
    ["response_types that is not a list", { ...CLAUDE_DOCUMENT, response_types: "code" }, /response_types is not a list/],
    [
      "an auth-methods list without none",
      { ...CLAUDE_DOCUMENT, token_endpoint_auth_method: undefined, token_endpoint_auth_methods_supported: ["private_key_jwt"] },
      /does not include none/,
    ],
    [
      "an auth-methods list that is not a list",
      { ...CLAUDE_DOCUMENT, token_endpoint_auth_methods_supported: "none" },
      /does not include none/,
    ],
    [
      "a shared-secret method in the list",
      { ...CLAUDE_DOCUMENT, token_endpoint_auth_methods_supported: ["none", "client_secret_post"] },
      /shared-secret/,
    ],
    [
      "a method outside its own list",
      { ...CLAUDE_DOCUMENT, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["none"] },
      /is not in token_endpoint_auth_methods_supported/,
    ],
  ])("is refused with %s", (_case, document, reason) => {
    expect(() => clientFromMetadataDocument(CLAUDE_ID, document, SCOPES)).toThrow(reason);
  });
});

describe("the resolver", () => {
  it("fetches once and serves the cached client while it is fresh", async () => {
    const transport = scripted(answer(CLAUDE_DOCUMENT));
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport });
    expect((await resolver.resolve(CLAUDE_ID))?.clientName).toBe("Claude");
    expect((await resolver.resolve(CLAUDE_ID))?.clientName).toBe("Claude");
    expect(transport.calls).toBe(1);
  });

  it("shares one fetch between concurrent lookups of one URL", async () => {
    const transport = scripted(answer(CLAUDE_DOCUMENT));
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport });
    await Promise.all([resolver.resolve(CLAUDE_ID), resolver.resolve(CLAUDE_ID), resolver.resolve(CLAUDE_ID)]);
    expect(transport.calls).toBe(1);
  });

  it("refetches once the response's own max-age has passed, clamped to the floor", async () => {
    const time = clock();
    const transport = scripted(answer(CLAUDE_DOCUMENT, 200, "public, max-age=1"));
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport, now: time.now });
    await resolver.resolve(CLAUDE_ID);
    time.advance(59_000);
    await resolver.resolve(CLAUDE_ID);
    expect(transport.calls).toBe(1);
    time.advance(2_000);
    await resolver.resolve(CLAUDE_ID);
    expect(transport.calls).toBe(2);
  });

  it("never caches a refusal: the next lookup fetches again", async () => {
    const refusals: string[] = [];
    const transport = scripted(answer({ ...CLAUDE_DOCUMENT, client_id: "https://other.example/x" }), answer(CLAUDE_DOCUMENT));
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport }, (_id, reason) => refusals.push(reason));
    expect(await resolver.resolve(CLAUDE_ID)).toBeNull();
    expect(refusals).toEqual(["document client_id does not match its URL"]);
    expect((await resolver.resolve(CLAUDE_ID))?.clientName).toBe("Claude");
    expect(transport.calls).toBe(2);
  });

  it.each([
    [404, null],
    [302, null],
    [410, null],
  ])("treats HTTP %s as a refusal", async (status) => {
    const statusResolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: scripted(answer("nope", status)) });
    expect(await statusResolver.resolve(CLAUDE_ID)).toBeNull();
  });

  it("refuses a body that is not JSON", async () => {
    const htmlResolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: scripted(answer("<html>")) });
    expect(await htmlResolver.resolve(CLAUDE_ID)).toBeNull();
  });

  it.each([
    ["a 503", answer("down", 503)],
    ["a 429", answer("slow down", 429)],
    ["a network error", new Error("ECONNRESET")],
    ["a timeout", new ClientMetadataDocumentError("document fetch timed out", { transient: true })],
  ])("answers %s with nothing cached as unavailable, not as unknown", async (_case, failure) => {
    const outageResolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: scripted(failure) });
    await expect(outageResolver.resolve(CLAUDE_ID)).rejects.toBeInstanceOf(ClientMetadataUnavailableError);
  });

  it("keeps serving the last valid document through an outage, up to its ceiling", async () => {
    const time = clock();
    const refusals: string[] = [];
    const transport = scripted(answer(CLAUDE_DOCUMENT), answer("down", 503));
    const resolver = createClientMetadataDocumentResolver(
      SCOPES,
      { fetchDocument: transport, now: time.now, staleIfErrorMs: 60 * 60 * 1000 },
      (_id, reason) => refusals.push(reason),
    );
    await resolver.resolve(CLAUDE_ID);
    time.advance(6 * 60 * 1000);
    expect((await resolver.resolve(CLAUDE_ID))?.clientName).toBe("Claude");
    expect(refusals.at(-1)).toMatch(/serving the last valid document/);
    time.advance(60 * 60 * 1000);
    await expect(resolver.resolve(CLAUDE_ID)).rejects.toBeInstanceOf(ClientMetadataUnavailableError);
  });

  it("drops the cached client the moment its document becomes invalid", async () => {
    const time = clock();
    const transport = scripted(answer(CLAUDE_DOCUMENT), answer({ ...CLAUDE_DOCUMENT, redirect_uris: [] }), answer("down", 503));
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport, now: time.now });
    await resolver.resolve(CLAUDE_ID);
    time.advance(6 * 60 * 1000);
    expect(await resolver.resolve(CLAUDE_ID)).toBeNull();
    // No earlier trust survives the refusal: an outage now has nothing to serve.
    await expect(resolver.resolve(CLAUDE_ID)).rejects.toBeInstanceOf(ClientMetadataUnavailableError);
  });

  it("refuses a bad client_id without fetching anything", async () => {
    const transport = scripted(answer(CLAUDE_DOCUMENT));
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport });
    expect(await resolver.resolve("https://10.0.0.1/x")).toBeNull();
    expect(await resolver.resolve("https://claude.ai")).toBeNull();
    expect(transport.calls).toBe(0);
  });

  it("caps how many documents are fetched at once", async () => {
    const gate = Promise.withResolvers<void>();
    const transport: FetchMetadataDocument = async (url) => {
      await gate.promise;
      return answer({ ...CLAUDE_DOCUMENT, client_id: url.href });
    };
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport, maxConcurrentFetches: 2 });
    const first = resolver.resolve("https://a.example/one");
    const second = resolver.resolve("https://b.example/two");
    await expect(resolver.resolve("https://c.example/three")).rejects.toBeInstanceOf(ClientMetadataUnavailableError);
    gate.resolve();
    expect((await first)?.clientId).toBe("https://a.example/one");
    expect((await second)?.clientId).toBe("https://b.example/two");
  });

  it("evicts the oldest document past the entry ceiling", async () => {
    const calls: string[] = [];
    const transport: FetchMetadataDocument = async (url) => {
      calls.push(url.href);
      return answer({ ...CLAUDE_DOCUMENT, client_id: url.href });
    };
    const resolver = createClientMetadataDocumentResolver(SCOPES, { fetchDocument: transport, maxEntries: 2 });
    await resolver.resolve("https://a.example/1");
    await resolver.resolve("https://b.example/2");
    await resolver.resolve("https://c.example/3");
    await resolver.resolve("https://a.example/1");
    expect(calls).toEqual(["https://a.example/1", "https://b.example/2", "https://c.example/3", "https://a.example/1"]);
  });
});

describe("a loopback redirect_uri", () => {
  const registered = ["http://localhost/callback", "http://127.0.0.1/callback"];

  it("matches on any port", () => {
    expect(matchesLoopbackRedirectUri(registered, "http://localhost:54321/callback")).toBe(true);
    expect(matchesLoopbackRedirectUri(registered, "http://127.0.0.1:8080/callback")).toBe(true);
  });

  it("matches on nothing else", () => {
    expect(matchesLoopbackRedirectUri(registered, "http://localhost:54321/other")).toBe(false);
    expect(matchesLoopbackRedirectUri(registered, "http://[::1]:54321/callback")).toBe(false);
    expect(matchesLoopbackRedirectUri(registered, "https://localhost:54321/callback")).toBe(false);
    expect(matchesLoopbackRedirectUri(registered, "http://localhost.evil.example:54321/callback")).toBe(false);
    expect(matchesLoopbackRedirectUri(registered, "http://localhost:54321/callback?x=1")).toBe(false);
    expect(matchesLoopbackRedirectUri(["https://claude.ai/api/mcp/auth_callback"], "http://localhost:1/api/mcp/auth_callback")).toBe(false);
    expect(matchesLoopbackRedirectUri(registered, "not a url")).toBe(false);
  });
});
