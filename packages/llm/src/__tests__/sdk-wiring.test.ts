/**
 * The adapters' DEFAULT clients, built from the real SDKs, with a recording
 * `fetch` that replays the recorded fixtures. Proves the credential reaches
 * the provider's own header and the SDK's request and response round-trip
 * through the mapping, with no network and no key.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdapterRegistry } from "../adapter";
import { anthropicAdapter } from "../adapters/anthropic";
import { geminiAdapter } from "../adapters/gemini";
import { openaiAdapter } from "../adapters/openai";
import { createModelClient } from "../client";
import { AuthError, InvalidRequestError } from "../errors";
import anthropicEnd from "./fixtures/anthropic/end-turn-cached.response.json";
import geminiCall from "./fixtures/gemini/function-call.response.json";
import openaiCalls from "./fixtures/openai/tool-calls.response.json";
import { sampleRequest } from "./helpers";

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
