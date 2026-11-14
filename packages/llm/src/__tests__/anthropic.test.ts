import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { anthropicAdapter, toAnthropicParams } from "../adapters/anthropic";
import { ResolvedCredential } from "../credentials";
import { AuthError, InvalidRequestError, ProviderUnavailableError, RateLimitError } from "../errors";
import endTurn from "./fixtures/anthropic/end-turn-cached.response.json";
import refusal from "./fixtures/anthropic/refusal.response.json";
import toolUse from "./fixtures/anthropic/tool-use.response.json";
import { httpError, sampleRequest } from "./helpers";

const credential = new ResolvedCredential("apiKey", "sk-test-secret-value");

function recordingAdapter(reply: () => unknown) {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const adapter = anthropicAdapter({
    client: () => ({
      messages: {
        create: async (params) => {
          sent.push(params);
          return reply();
        },
      },
    }),
  });
  return { adapter, sent };
}

describe("anthropic adapter: the request", () => {
  it("maps system blocks in order with cache breakpoints, strict tools and the effort hint", () => {
    const params = toAnthropicParams({ model: "claude-haiku-5-5", request: sampleRequest(), credential });
    expect(params.system).toEqual([
      { type: "text", text: "You answer questions about one store." },
      { type: "text", text: "CATALOG: two pizzas.", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
    expect(params.tools).toEqual([
      {
        name: "search_menu",
        description: "Search the catalog by free text.",
        input_schema: sampleRequest().tools?.[0]?.inputSchema,
        strict: true,
      },
    ]);
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.max_tokens).toBe(1024);
    expect(params.cache_control).toBeUndefined();
  });

  it("maps the conversation, tool results included, onto user and assistant turns", () => {
    const params = toAnthropicParams({ model: "m", request: sampleRequest(), credential });
    expect(params.messages).toEqual([
      { role: "user", content: "Do you have pizza?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "call_1", name: "search_menu", input: { query: "pizza", limit: null } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "2 results" }] },
      { role: "user", content: "Which ones?" },
    ]);
  });

  it("replays its own raw turn verbatim, thinking block and all", () => {
    const raw = toolUse.content;
    const request = sampleRequest({
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "", toolCalls: [], raw: { provider: "anthropic", content: raw } },
      ],
    });
    const params = toAnthropicParams({ model: "m", request, credential });
    expect(params.messages[1]).toEqual({ role: "assistant", content: raw });
  });

  it("maps tool choice none and required, and the conversation breakpoint", () => {
    const none = toAnthropicParams({ model: "m", request: sampleRequest({ toolChoice: "none" }), credential });
    const required = toAnthropicParams({ model: "m", request: sampleRequest({ toolChoice: "required", cacheConversation: true }), credential });
    expect(none.tool_choice).toEqual({ type: "none" });
    expect(required.tool_choice).toEqual({ type: "any" });
    expect(required.cache_control).toEqual({ type: "ephemeral" });
  });

  it("refuses more than four cache breakpoints", () => {
    const system = Array.from({ length: 4 }, (_, i) => ({ text: `block ${i}`, cache: true }));
    expect(() =>
      toAnthropicParams({ model: "m", request: sampleRequest({ system, cacheConversation: true }), credential }),
    ).toThrow(InvalidRequestError);
  });
});

describe("anthropic adapter: the response", () => {
  it("normalizes a tool-use turn: calls, stop reason, usage with cache writes", async () => {
    const { adapter: recording, sent } = recordingAdapter(() => toolUse);
    const result = await recording.chat({ model: "claude-haiku-5-5", request: sampleRequest(), credential });
    expect(sent).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
    expect(result.text).toBe("Let me check the menu.");
    expect(result.toolCalls).toEqual([{ id: "toolu_01Fixture", name: "search_menu", input: { query: "pizza", limit: null } }]);
    expect(result.usage).toMatchObject({ inputTokens: 42, cacheCreationTokens: 2048, cacheReadTokens: 0, outputTokens: 61 });
    expect(result.usage.raw).toEqual(toolUse.usage);
    expect(result.message.raw).toEqual({ provider: "anthropic", content: toolUse.content });
  });

  it("normalizes an end turn with cache reads and joins the text blocks", async () => {
    const { adapter: recording } = recordingAdapter(() => endTurn);
    const result = await recording.chat({ model: "m", request: sampleRequest(), credential });
    expect(result.stopReason).toBe("end");
    expect(result.text).toBe("We have two pizzas on the menu today.");
    expect(result.usage).toMatchObject({ inputTokens: 17, cacheCreationTokens: 0, cacheReadTokens: 2048, outputTokens: 12 });
  });

  it("maps a refusal and its stop details", async () => {
    const { adapter: recording } = recordingAdapter(() => refusal);
    const result = await recording.chat({ model: "m", request: sampleRequest(), credential });
    expect(result.stopReason).toBe("refusal");
    expect(result.refusal).toEqual({ category: "cyber", explanation: "The request asks for exploit development." });
    expect(result.usage).toMatchObject({ cacheCreationTokens: 0, cacheReadTokens: 0 });
  });
});

describe("anthropic adapter: errors", () => {
  async function failWith(error: Error) {
    const failingAdapter = anthropicAdapter({
      client: () => ({
        messages: {
          create: async () => {
            throw error;
          },
        },
      }),
    });
    return failingAdapter.chat({ model: "m", request: sampleRequest(), credential }).catch((e: unknown) => e);
  }

  it("maps 429 to a rate limit with the retry-after hint", async () => {
    const error = await failWith(httpError(429, "rate limited", { "retry-after": "7" }));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(7000);
  });

  it("maps 401 to an auth error and scrubs the secret from the message", async () => {
    const error = await failWith(httpError(401, "invalid x-api-key sk-test-secret-value"));
    expect(error).toBeInstanceOf(AuthError);
    expect((error as Error).message).not.toContain("sk-test-secret-value");
  });

  it("maps 529 and connection failures to provider unavailable", async () => {
    expect(await failWith(httpError(529, "overloaded"))).toBeInstanceOf(ProviderUnavailableError);
    expect(await failWith(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))).toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});
