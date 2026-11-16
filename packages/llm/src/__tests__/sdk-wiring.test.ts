/**
 * The adapters' DEFAULT clients, built from the real SDKs, with a recording
 * `fetch` that replays the recorded fixtures. Proves the credential reaches
 * the provider's own header and the SDK's request and response round-trip
 * through the mapping, with no network and no key.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdapterRegistry } from "../adapter";
import { ANTHROPIC_BASE_URL, ANTHROPIC_ROUTES, anthropicAdapter } from "../adapters/anthropic";
import { GEMINI_BASE_URL, GEMINI_ROUTES, geminiAdapter } from "../adapters/gemini";
import { OPENAI_BASE_URL, OPENAI_ROUTES, openaiAdapter } from "../adapters/openai";
import { sealedFetch } from "../adapters/sealed-fetch";
import { XAI_BASE_URL, xaiAdapter } from "../adapters/xai";
import { createModelClient } from "../client";
import { AuthError, InvalidRequestError } from "../errors";
import anthropicEnd from "./fixtures/anthropic/end-turn-cached.response.json";
import geminiCall from "./fixtures/gemini/function-call.response.json";
import openaiCalls from "./fixtures/openai/tool-calls.response.json";
import { sampleRequest } from "./helpers";

const OPENAI_TEST_ROUTES = [{ method: "POST", path: "/chat/completions" }] as const;

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A `fetch` that answers every request with one JSON body and records it. */
function recordingFetch(reply: unknown, status = 200) {
  const seen: Seen[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const outgoing = new Request(input, init);
    const text = await outgoing.text();
    seen.push({ url: outgoing.url, headers: outgoing.headers, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
    return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
}

function only(seen: Seen[]): Seen {
  expect(seen).toHaveLength(1);
  const [entry] = seen;
  if (!entry) throw new Error("no request was sent");
  return entry;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("default SDK clients", () => {
  it("anthropic: sends the API key and the mapped body, reads the response", async () => {
    const { fetch, seen } = recordingFetch(anthropicEnd);
    const client = createModelClient({
      provider: "anthropic",
      credentials: { kind: "apiKey", apiKey: "sk-wiring-key" },
      registry: createAdapterRegistry([anthropicAdapter({ fetch })]),
    });
    const result = await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(`${sent.headers.get("x-api-key") ?? ""} ${sent.headers.get("authorization") ?? ""}`).toContain("sk-wiring-key");
    expect(sent.body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1024, output_config: { effort: "low" } });
    expect(result.text).toBe("We have two pizzas on the menu today.");
    expect(result.usage.cacheReadTokens).toBe(2048);
  });

  it("anthropic: sends an OAuth token as a bearer with the OAuth beta header", async () => {
    const { fetch, seen } = recordingFetch(anthropicEnd);
    const client = createModelClient({
      provider: "anthropic",
      credentials: { kind: "oauth", token: () => ({ accessToken: "oauth-wiring-token" }), refresh: () => ({ accessToken: "x" }) },
      registry: createAdapterRegistry([anthropicAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.headers.get("authorization")).toBe("Bearer oauth-wiring-token");
    expect(sent.headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
  });

  it("openai: sends the key as a bearer and reads the tool calls", async () => {
    const { fetch, seen } = recordingFetch(openaiCalls);
    const client = createModelClient({
      provider: "openai",
      model: "gpt-fixture-1",
      credentials: { kind: "apiKey", apiKey: "sk-openai-wiring" },
      registry: createAdapterRegistry([openaiAdapter({ fetch })]),
    });
    const result = await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent.headers.get("authorization")).toBe("Bearer sk-openai-wiring");
    expect(sent.body).toMatchObject({ model: "gpt-fixture-1", max_completion_tokens: 1024 });
    expect(result.toolCalls[0]?.name).toBe("search_menu");
  });

  it("gemini: sends the key in its header and reads the function call", async () => {
    const { fetch, seen } = recordingFetch(geminiCall);
    const client = createModelClient({
      provider: "gemini",
      model: "gemini-fixture-1",
      credentials: { kind: "apiKey", apiKey: "gemini-wiring-key" },
      registry: createAdapterRegistry([geminiAdapter({ fetch })]),
    });
    const result = await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.url).toContain("gemini-fixture-1:generateContent");
    expect(sent.headers.get("x-goog-api-key")).toBe("gemini-wiring-key");
    expect(sent.body).toMatchObject({ generationConfig: { maxOutputTokens: 1024 } });
    expect(result.toolCalls[0]?.id).toBe("fc_fixture_1");
  });

  it("gemini: sends a Google OAuth token as a bearer and no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_API_KEY", undefined);
    const { fetch, seen } = recordingFetch(geminiCall);
    const client = createModelClient({
      provider: "gemini",
      model: "gemini-fixture-1",
      credentials: { kind: "oauth", token: () => ({ accessToken: "ya29.wiring" }), refresh: () => ({ accessToken: "x" }) },
      registry: createAdapterRegistry([geminiAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.headers.get("authorization")).toBe("Bearer ya29.wiring");
    expect(sent.headers.get("x-goog-api-key")).toBeNull();
  });

  it("gemini: refuses OAuth when an environment key would replace the token", async () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key-that-would-win");
    const { fetch, seen } = recordingFetch(geminiCall);
    const client = createModelClient({
      provider: "gemini",
      model: "gemini-fixture-1",
      credentials: { kind: "oauth", token: () => ({ accessToken: "ya29.wiring" }), refresh: () => ({ accessToken: "x" }) },
      registry: createAdapterRegistry([geminiAdapter({ fetch })]),
    });
    await expect(client.chat(sampleRequest())).rejects.toBeInstanceOf(InvalidRequestError);
    expect(seen).toHaveLength(0);
  });

  it("maps the SDK's real 401 to an AuthError", async () => {
    const { fetch } = recordingFetch({ error: { message: "unauthorized" } }, 401);
    const client = createModelClient({
      provider: "openai",
      model: "gpt-fixture-1",
      credentials: { kind: "apiKey", apiKey: "sk-openai-wiring" },
      registry: createAdapterRegistry([openaiAdapter({ fetch })]),
    });
    await expect(client.chat(sampleRequest())).rejects.toBeInstanceOf(AuthError);
  });
});

/** What a platform's own environment holds: none of it may reach a store's call (B3). */
function stubPlatformEnvironment(): void {
  vi.stubEnv("OPENAI_API_KEY", "sk-platform-openai");
  vi.stubEnv("OPENAI_ORG_ID", "org-platform");
  vi.stubEnv("OPENAI_PROJECT_ID", "proj_platform");
  vi.stubEnv("OPENAI_BASE_URL", "https://platform-proxy.example/v1");
  vi.stubEnv("OPENAI_CUSTOM_HEADERS", "X-Platform-Tenant: platform");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-platform");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "platform-bearer");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://platform-proxy.example");
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "X-Platform-Tenant: platform");
  vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "platform-project");
  vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1");
  vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://platform-proxy.example/");
}

/** Every header value the request carries, to search for a platform value. */
function headerValues(sent: Seen): string {
  return [...sent.headers.entries()].map(([name, value]) => `${name}: ${value}`).join("\n");
}

describe("a store's own key reaches its provider alone (B3)", () => {
  it("openai: no platform organisation, project, base URL, key or custom header", async () => {
    stubPlatformEnvironment();
    const { fetch, seen } = recordingFetch(openaiCalls);
    const client = createModelClient({
      provider: "openai",
      model: "gpt-fixture-1",
      credentials: { kind: "apiKey", apiKey: "sk-store-own" },
      registry: createAdapterRegistry([openaiAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent.headers.get("authorization")).toBe("Bearer sk-store-own");
    expect(sent.headers.get("openai-organization")).toBeNull();
    expect(sent.headers.get("openai-project")).toBeNull();
    expect(headerValues(sent)).not.toMatch(/platform/);
  });

  it("anthropic: an API key goes out alone, never beside the platform's bearer token", async () => {
    stubPlatformEnvironment();
    const { fetch, seen } = recordingFetch(anthropicEnd);
    const client = createModelClient({
      provider: "anthropic",
      credentials: { kind: "apiKey", apiKey: "sk-ant-store-own" },
      registry: createAdapterRegistry([anthropicAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers.get("x-api-key")).toBe("sk-ant-store-own");
    expect(sent.headers.get("authorization")).toBeNull();
    expect(headerValues(sent)).not.toMatch(/platform/);
  });

  it("anthropic: an OAuth token goes out alone, never beside the platform's API key", async () => {
    stubPlatformEnvironment();
    const { fetch, seen } = recordingFetch(anthropicEnd);
    const client = createModelClient({
      provider: "anthropic",
      credentials: { kind: "oauth", token: () => ({ accessToken: "store-oauth" }), refresh: () => ({ accessToken: "x" }) },
      registry: createAdapterRegistry([anthropicAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.headers.get("authorization")).toBe("Bearer store-oauth");
    expect(sent.headers.get("x-api-key")).toBeNull();
    expect(headerValues(sent)).not.toMatch(/platform/);
  });

  it("gemini: the Gemini API with the store's key, never the platform's Vertex project", async () => {
    stubPlatformEnvironment();
    const { fetch, seen } = recordingFetch(geminiCall);
    const client = createModelClient({
      provider: "gemini",
      model: "gemini-fixture-1",
      credentials: { kind: "apiKey", apiKey: "gemini-store-own" },
      registry: createAdapterRegistry([geminiAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    const sent = only(seen);
    expect(sent.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/.*gemini-fixture-1:generateContent/);
    expect(sent.headers.get("x-goog-api-key")).toBe("gemini-store-own");
    expect(headerValues(sent)).not.toMatch(/platform/);
  });

  it("xai: xAI's own API root with the store's xAI key, and nothing of the platform's OpenAI account", async () => {
    stubPlatformEnvironment();
    const { fetch, seen } = recordingFetch(openaiCalls);
    const client = createModelClient({
      provider: "xai",
      model: "grok-fixture-1",
      credentials: { kind: "apiKey", apiKey: "xai-store-own" },
      registry: createAdapterRegistry([xaiAdapter({ fetch })]),
    });
    const result = await client.chat(sampleRequest({ cacheKey: "store-42" }));
    const sent = only(seen);
    expect(sent.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(sent.headers.get("authorization")).toBe("Bearer xai-store-own");
    expect(sent.headers.get("openai-organization")).toBeNull();
    expect(headerValues(sent)).not.toMatch(/platform/);
    expect(sent.body).not.toHaveProperty("prompt_cache_key");
    expect(result.provider).toBe("xai");
  });

  it("the sealed fetch refuses a request outside the adapter's base URL", async () => {
    const { fetch, seen } = recordingFetch({});
    const sealed = sealedFetch({ provider: "openai", baseURL: "https://api.openai.com/v1", routes: OPENAI_TEST_ROUTES, auth: { authorization: "Bearer k" }, fetch });
    await expect(sealed("https://platform-proxy.example/v1/chat/completions", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    await expect(sealed("https://api.openai.com/v1-evil/chat", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(InvalidRequestError);
    expect(seen).toHaveLength(0);
  });
});

describe("custom-header variables (R1, R2)", () => {
  const MALFORMED = "X-Tenant: platform\nnote without a colon";
  const cases = [
    { provider: "openai", adapter: (fetch: typeof globalThis.fetch) => openaiAdapter({ fetch }), reply: openaiCalls, model: "gpt-fixture-1" },
    { provider: "xai", adapter: (fetch: typeof globalThis.fetch) => xaiAdapter({ fetch }), reply: openaiCalls, model: "grok-fixture-1" },
    { provider: "anthropic", adapter: (fetch: typeof globalThis.fetch) => anthropicAdapter({ fetch }), reply: anthropicEnd, model: undefined },
    { provider: "gemini", adapter: (fetch: typeof globalThis.fetch) => geminiAdapter({ fetch }), reply: geminiCall, model: "gemini-fixture-1" },
  ];
  for (const { provider, adapter, reply, model } of cases) {
    it(`${provider}: a line without a colon never throws, and its named header is still dropped (R1)`, async () => {
      vi.stubEnv("OPENAI_CUSTOM_HEADERS", MALFORMED);
      vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", MALFORMED);
      const { fetch, seen } = recordingFetch(reply);
      const client = createModelClient({
        provider,
        model,
        credentials: { kind: "apiKey", apiKey: "store-own" },
        registry: createAdapterRegistry([adapter(fetch)]),
      });
      await client.chat(sampleRequest());
      expect(only(seen).headers.get("x-tenant")).toBeNull();
    });
  }

  it("anthropic OAuth keeps its own anthropic-beta when the environment names that header (R2)", async () => {
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "anthropic-beta: platform-beta");
    const { fetch, seen } = recordingFetch(anthropicEnd);
    const client = createModelClient({
      provider: "anthropic",
      credentials: { kind: "oauth", token: () => ({ accessToken: "store-oauth" }), refresh: () => ({ accessToken: "x" }) },
      registry: createAdapterRegistry([anthropicAdapter({ fetch })]),
    });
    await client.chat(sampleRequest());
    expect(only(seen).headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
  });
});

describe("redirects and the path allow-list (round 4)", () => {
  const routes = OPENAI_TEST_ROUTES;

  it("never follows a redirect: the other origin is not requested and no key leaves for it", async () => {
    const requested: Array<{ url: string; headers: Headers }> = [];
    // A double that behaves like fetch with redirect "follow": it chases a 302 and keeps x-api-key.
    const doubleFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      requested.push({ url, headers: new Headers(init?.headers) });
      if (url.startsWith("https://api.openai.com/")) {
        const location = { location: "https://evil.example/steal" };
        if (init?.redirect === "manual") return new Response(null, { status: 302, headers: location });
        return doubleFetch("https://evil.example/steal", init);
      }
      return new Response("{}", { status: 200 });
    };
    const sealed = sealedFetch({ provider: "openai", baseURL: "https://api.openai.com/v1", routes, auth: { "x-api-key": "sk-secret" }, fetch: doubleFetch as typeof globalThis.fetch });
    await expect(sealed("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" })).rejects.toMatchObject({
      name: "InvalidRequestError",
      status: 302,
    });
    expect(requested.map((entry) => new URL(entry.url).origin)).toEqual(["https://api.openai.com"]);
    expect(requested.some((entry) => entry.url.includes("evil.example"))).toBe(false);
  });

  it("refuses another path or method under the base URL", async () => {
    const { fetch, seen } = recordingFetch({});
    const sealed = sealedFetch({ provider: "openai", baseURL: "https://api.openai.com/v1", routes, auth: { authorization: "Bearer k" }, fetch });
    await expect(sealed("https://api.openai.com/v1/files", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(sealed("https://api.openai.com/v1/chat/completions", { method: "GET" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(sealed("https://api.openai.com/v1/chat/completions", { method: "DELETE" })).rejects.toBeInstanceOf(InvalidRequestError);
    expect(seen).toHaveLength(0);
  });

  it("each adapter's allow-list refuses /files under its own base, and the real SDK call still passes", async () => {
    const cases = [
      { provider: "anthropic", base: ANTHROPIC_BASE_URL, routes: ANTHROPIC_ROUTES, other: "https://api.anthropic.com/v1/files" },
      { provider: "gemini", base: GEMINI_BASE_URL, routes: GEMINI_ROUTES, other: "https://generativelanguage.googleapis.com/v1beta/files" },
      { provider: "openai", base: OPENAI_BASE_URL, routes: OPENAI_ROUTES, other: "https://api.openai.com/v1/files" },
      { provider: "xai", base: XAI_BASE_URL, routes: OPENAI_ROUTES, other: "https://api.x.ai/v1/files" },
    ];
    for (const { provider, base, routes: own, other } of cases) {
      const { fetch, seen } = recordingFetch({});
      const sealed = sealedFetch({ provider, baseURL: base, routes: own, auth: { authorization: "Bearer k" }, fetch });
      await expect(sealed(other, { method: "POST", body: "{}" })).rejects.toBeInstanceOf(InvalidRequestError);
      expect(seen).toHaveLength(0);
    }
  });
});
