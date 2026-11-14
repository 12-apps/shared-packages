import { describe, expect, it, vi } from "vitest";

import { createAdapterRegistry } from "../adapter";
import { builtInAdapters } from "../adapters";
import { createModelClient, retryTransient } from "../client";
import { ResolvedCredential, createCredentialSession } from "../credentials";
import { AuthError, InvalidRequestError, ProviderUnavailableError, RateLimitError, UnsupportedError } from "../errors";
import { scriptedAdapter } from "./fake-adapter";
import { sampleRequest, searchMenu } from "./helpers";

const apiKey = { kind: "apiKey" as const, apiKey: "sk-static-secret" };

function clientFor(adapter: ReturnType<typeof scriptedAdapter>["adapter"], extra: Record<string, unknown> = {}) {
  return createModelClient({
    provider: adapter.id,
    credentials: apiKey,
    registry: createAdapterRegistry([adapter]),
    sleep: async () => {},
    ...extra,
  });
}

describe("the factory and the registry", () => {
  it("ships the three built-in adapters, Anthropic defaulting to Claude Haiku 5.5", () => {
    const registry = createAdapterRegistry(builtInAdapters());
    expect(registry.ids()).toEqual(["anthropic", "openai", "gemini"]);
    expect(createModelClient({ provider: "anthropic", credentials: apiKey }).model).toBe("claude-haiku-5-5");
  });

  it("selects a host-registered adapter by provider id, without editing the package", async () => {
    const { adapter, calls } = scriptedAdapter([{ text: "hello" }], { id: "local-llm" });
    const registry = createAdapterRegistry(builtInAdapters()).register(adapter);
    const client = createModelClient({ provider: "local-llm", credentials: apiKey, registry });
    expect(client.provider).toBe("local-llm");
    expect(client.supports("chat")).toBe(true);
    const result = await client.chat(sampleRequest());
    expect(result.text).toBe("hello");
    expect(calls[0]?.model).toBe("fake-model");
    expect(calls[0]?.credential.secret).toBe("sk-static-secret");
  });

  it("refuses a duplicate id unless asked to replace, and an unknown provider", () => {
    const registry = createAdapterRegistry(builtInAdapters());
    const { adapter } = scriptedAdapter([], { id: "anthropic" });
    expect(() => registry.register(adapter)).toThrow(/already registered/);
    expect(() => registry.register(adapter, { replace: true })).not.toThrow();
    expect(() => createModelClient({ provider: "nobody", credentials: apiKey, registry })).toThrow(UnsupportedError);
  });

  it("refuses a credential kind the adapter does not declare", () => {
    const oauth = { kind: "oauth" as const, token: () => ({ accessToken: "t" }), refresh: () => ({ accessToken: "t2" }) };
    expect(() => createModelClient({ provider: "openai", model: "any", credentials: oauth })).toThrow(UnsupportedError);
    expect(() => createModelClient({ provider: "gemini", model: "any", credentials: oauth })).not.toThrow();
  });

  it("asks for a model when the adapter has no default", () => {
    expect(() => createModelClient({ provider: "openai", credentials: apiKey })).toThrow(InvalidRequestError);
  });

  it("refuses a tool schema that is not strict before any call", async () => {
    const { adapter, calls } = scriptedAdapter([{ text: "x" }]);
    const loose = { ...searchMenu, inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } };
    const error = await clientFor(adapter).chat(sampleRequest({ tools: [loose] })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect((error as Error).message).toMatch(/additionalProperties: false/);
    expect((error as Error).message).toMatch(/"limit" must be listed in required/);
    expect(calls).toHaveLength(0);
  });

  it("finds a loose object nested inside a strict one", async () => {
    const { adapter } = scriptedAdapter([{ text: "x" }]);
    const nested = {
      ...searchMenu,
      inputSchema: {
        type: "object",
        properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
        required: ["items"],
        additionalProperties: false,
      },
    };
    await expect(clientFor(adapter).chat(sampleRequest({ tools: [nested] }))).rejects.toThrow(/\$\.properties\.items\.items: an object must set/);
  });
});

describe("credentials", () => {
  it("never prints a resolved secret", () => {
    const credential = new ResolvedCredential("apiKey", "sk-do-not-print");
    expect(JSON.stringify({ credential })).not.toContain("sk-do-not-print");
    expect(String(credential)).toBe("[credential apiKey]");
    expect(Object.keys(credential)).not.toContain("secret");
  });

  it("reads an API key through the host's resolver on every call", async () => {
    const resolver = vi.fn(() => "sk-rotating");
    const { adapter, calls } = scriptedAdapter([{ text: "a" }]);
    const client = clientFor(adapter, { credentials: { kind: "apiKey", apiKey: resolver } });
    await client.chat(sampleRequest());
    await client.chat(sampleRequest());
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.credential.secret)).toEqual(["sk-rotating", "sk-rotating"]);
  });

  it("refreshes an OAuth token that is about to expire, before the call", async () => {
    const now = 1_000_000;
    const refresh = vi.fn(() => ({ accessToken: "fresh", expiresAt: now + 3_600_000 }));
    const session = createCredentialSession(
      { kind: "oauth", token: () => ({ accessToken: "stale", expiresAt: now + 30_000 }), refresh },
      { now: () => now },
    );
    const credential = await session.current();
    expect(credential.secret).toBe("fresh");
    expect(refresh).toHaveBeenCalledWith("expiring");
  });

  it("uses a token with time left without refreshing it", async () => {
    const refresh = vi.fn(() => ({ accessToken: "fresh" }));
    const session = createCredentialSession(
      { kind: "oauth", token: () => ({ accessToken: "valid", expiresAt: 10_000_000 }), refresh },
      { now: () => 1_000_000 },
    );
    expect((await session.current()).secret).toBe("valid");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("on a 401 refreshes the OAuth token exactly once and retries once", async () => {
    const refresh = vi.fn(() => ({ accessToken: "renewed" }));
    const { adapter, calls } = scriptedAdapter([{ error: new AuthError("fake", "expired", 401) }, { text: "ok" }]);
    const client = clientFor(adapter, { credentials: { kind: "oauth", token: () => ({ accessToken: "old" }), refresh } });
    const result = await client.chat(sampleRequest());
    expect(result.text).toBe("ok");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("unauthorized");
    expect(calls.map((call) => call.credential.secret)).toEqual(["old", "renewed"]);
  });

  it("gives up after the one refresh when the renewed token is refused too", async () => {
    const refresh = vi.fn(() => ({ accessToken: "renewed" }));
    const retry = vi.fn(() => null);
    const { adapter, calls } = scriptedAdapter([{ error: new AuthError("fake", "nope", 401) }]);
    const client = clientFor(adapter, { credentials: { kind: "oauth", token: () => ({ accessToken: "old" }), refresh }, retry });
    await expect(client.chat(sampleRequest())).rejects.toBeInstanceOf(AuthError);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("never retries a 401 on an API key", async () => {
    const { adapter, calls } = scriptedAdapter([{ error: new AuthError("fake", "bad key", 401) }]);
    await expect(clientFor(adapter).chat(sampleRequest())).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(1);
  });
});

describe("the retry policy hook", () => {
  it("does not retry by default", async () => {
    const { adapter, calls } = scriptedAdapter([{ error: new ProviderUnavailableError("fake", "down", 503) }, { text: "ok" }]);
    await expect(clientFor(adapter).chat(sampleRequest())).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("retries as the host's policy says, waiting the delay it returns", async () => {
    const sleep = vi.fn(async () => {});
    const { adapter, calls } = scriptedAdapter([
      { error: new RateLimitError("fake", "slow", 1500) },
      { error: new ProviderUnavailableError("fake", "down", 503) },
      { text: "ok" },
    ]);
    const client = clientFor(adapter, { retry: retryTransient({ maxAttempts: 3, baseDelayMs: 100 }), sleep });
    expect((await client.chat(sampleRequest())).text).toBe("ok");
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[1500], [200]]);
  });

  it("stops when the policy returns null, and never retries an invalid request", async () => {
    const policy = retryTransient({ maxAttempts: 5 });
    expect(policy(new InvalidRequestError("fake", "bad", 400), 1)).toBeNull();
    expect(policy(new ProviderUnavailableError("fake", "down"), 5)).toBeNull();
  });
});
