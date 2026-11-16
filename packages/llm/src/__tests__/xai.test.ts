/**
 * The xAI (Grok) adapter keeps the contract the other three keep (FUT-3738):
 * the same request mapping, tool calls, refusals and typed errors, stamped
 * with its own provider id. xAI speaks OpenAI's Chat Completions, so the
 * fixtures are the OpenAI wire shape.
 */
import { describe, expect, it } from "vitest";

import { builtInAdapters } from "../adapters";
import { xaiAdapter } from "../adapters/xai";
import { createAdapterRegistry } from "../adapter";
import { createModelClient } from "../client";
import { ResolvedCredential } from "../credentials";
import { InvalidRequestError, InvalidResponseError, RateLimitError } from "../errors";
import contentFilter from "./fixtures/openai/content-filter.response.json";
import refusal from "./fixtures/openai/refusal.response.json";
import toolCalls from "./fixtures/openai/tool-calls.response.json";
import { httpError, sampleRequest } from "./helpers";

const credential = new ResolvedCredential("apiKey", "xai-test-secret");

function adapterReplying(reply: () => unknown) {
  const sent: Record<string, unknown>[] = [];
  const adapter = xaiAdapter({
    client: () => ({
      chat: {
        completions: {
          create: async (params) => {
            sent.push(params as Record<string, unknown>);
            return reply();
          },
        },
      },
    }),
  });
  return { adapter, sent };
}

function failing(error: Error) {
  return xaiAdapter({
    client: () => ({
      chat: {
        completions: {
          create: async () => {
            throw error;
          },
        },
      },
    }),
  }).chat({ model: "grok-fixture-1", request: sampleRequest(), credential });
}

describe("xai adapter", () => {
  it("is a built-in provider with no default model: the host names the Grok model it pays for", () => {
    expect(createAdapterRegistry(builtInAdapters()).ids()).toContain("xai");
    expect(() => createModelClient({ provider: "xai", credentials: { kind: "apiKey", apiKey: "k" } })).toThrow(InvalidRequestError);
    expect(createModelClient({ provider: "xai", model: "grok-fixture-1", credentials: { kind: "apiKey", apiKey: "k" } }).model).toBe(
      "grok-fixture-1",
    );
  });

  it("accepts API keys only", () => {
    expect(() =>
      createModelClient({
        provider: "xai",
        model: "grok-fixture-1",
        credentials: { kind: "oauth", token: () => ({ accessToken: "t" }), refresh: () => ({ accessToken: "t" }) },
      }),
    ).toThrow(/does not accept "oauth"/);
  });

  it("maps the request as Chat Completions, without OpenAI's prompt_cache_key", async () => {
    const recorded = adapterReplying(() => toolCalls);
    const sent = recorded.sent;
    await recorded.adapter.chat({ model: "grok-fixture-1", request: sampleRequest({ cacheKey: "store-42", temperature: 0.2 }), credential });
    expect(sent[0]).toMatchObject({ model: "grok-fixture-1", max_completion_tokens: 1024, temperature: 0.2 });
    expect(sent[0]).not.toHaveProperty("prompt_cache_key");
    expect((sent[0]?.tools as { function: { strict: boolean } }[])[0]?.function.strict).toBe(true);
  });

  it("parses tool calls and usage, stamped with its own provider", async () => {
    const result = await adapterReplying(() => toolCalls).adapter.chat({ model: "grok-fixture-1", request: sampleRequest(), credential });
    expect(result.provider).toBe("xai");
    expect(result.message.raw?.provider).toBe("xai");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "call_Fixture1", name: "search_menu", input: { query: "pizza", limit: null } }]);
    expect(result.usage).toMatchObject({ inputTokens: 180, cacheReadTokens: 1920, outputTokens: 25 });
  });

  it("maps a refusal and a content filter stop to a refusal", async () => {
    const refused = await adapterReplying(() => refusal).adapter.chat({ model: "m", request: sampleRequest(), credential });
    expect(refused.refusal).toEqual({ category: null, explanation: "I can't help with that." });
    const filtered = await adapterReplying(() => contentFilter).adapter.chat({ model: "m", request: sampleRequest(), credential });
    expect(filtered.stopReason).toBe("refusal");
  });

  it("refuses tool arguments that are not JSON, naming xai", async () => {
    const broken = structuredClone(toolCalls);
    const call = broken.choices[0]?.message.tool_calls?.[0];
    if (call) call.function.arguments = "{not json";
    const replaying = adapterReplying(() => broken).adapter;
    await expect(replaying.chat({ model: "m", request: sampleRequest(), credential })).rejects.toMatchObject({
      constructor: InvalidResponseError,
      provider: "xai",
    });
  });

  it("maps SDK errors by status", async () => {
    await expect(failing(httpError(429, "slow down", { "retry-after-ms": "250" }))).rejects.toMatchObject({
      constructor: RateLimitError,
      retryAfterMs: 250,
    });
    await expect(failing(httpError(400, "bad"))).rejects.toBeInstanceOf(InvalidRequestError);
  });
});
