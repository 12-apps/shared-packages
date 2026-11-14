import { describe, expect, it } from "vitest";

import { openaiAdapter, toOpenAIParams } from "../adapters/openai";
import { ResolvedCredential } from "../credentials";
import { InvalidRequestError, InvalidResponseError, RateLimitError } from "../errors";
import contentFilter from "./fixtures/openai/content-filter.response.json";
import refusal from "./fixtures/openai/refusal.response.json";
import toolCalls from "./fixtures/openai/tool-calls.response.json";
import { httpError, sampleRequest } from "./helpers";

const credential = new ResolvedCredential("apiKey", "sk-openai-test-secret");

function adapterReplying(reply: () => unknown) {
  const sent: unknown[] = [];
  const adapter = openaiAdapter({
    client: () => ({
      chat: {
        completions: {
          create: async (params) => {
            sent.push(params);
            return reply();
          },
        },
      },
    }),
  });
  return { adapter, sent };
}

describe("openai adapter: the request", () => {
  it("maps system blocks, the conversation, strict function tools and the hints", () => {
    const params = toOpenAIParams({
      model: "gpt-fixture-1",
      request: sampleRequest({ temperature: 0.2, cacheKey: "store-42" }),
      credential,
    });
    expect(params.messages).toEqual([
      {
        role: "system",
        content: [
          { type: "text", text: "You answer questions about one store." },
          { type: "text", text: "CATALOG: two pizzas." },
        ],
      },
      { role: "user", content: "Do you have pizza?" },
      {
        role: "assistant",
        content: "Checking.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search_menu", arguments: '{"query":"pizza","limit":null}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "2 results" },
      { role: "user", content: "Which ones?" },
    ]);
    expect(params.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search_menu",
          description: "Search the catalog by free text.",
          parameters: sampleRequest().tools?.[0]?.inputSchema,
          strict: true,
        },
      },
    ]);
    expect(params).toMatchObject({
      tool_choice: "auto",
      reasoning_effort: "low",
      temperature: 0.2,
      prompt_cache_key: "store-42",
      max_completion_tokens: 1024,
    });
  });

  it("marks an error tool result in its content, and passes required through", () => {
    const request = sampleRequest({ toolChoice: "required" });
    request.messages[2] = { role: "tool", results: [{ callId: "call_1", name: "search_menu", output: "boom", isError: true }] };
    const params = toOpenAIParams({ model: "m", request, credential });
    expect(params.tool_choice).toBe("required");
    expect(params.messages).toContainEqual({ role: "tool", tool_call_id: "call_1", content: "[tool error] boom" });
  });
});

describe("openai adapter: the response", () => {
  it("parses tool call arguments and normalizes usage with cached prompt tokens", async () => {
    const { adapter: replaying, sent } = adapterReplying(() => toolCalls);
    const result = await replaying.chat({ model: "gpt-fixture-1", request: sampleRequest(), credential });
    expect(sent).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "call_Fixture1", name: "search_menu", input: { query: "pizza", limit: null } }]);
    expect(result.usage).toMatchObject({ inputTokens: 180, cacheCreationTokens: 0, cacheReadTokens: 1920, outputTokens: 25 });
    expect(result.usage.raw).toEqual(toolCalls.usage);
  });

  it("maps the message's refusal field to a refusal", async () => {
    const { adapter: replaying } = adapterReplying(() => refusal);
    const result = await replaying.chat({ model: "m", request: sampleRequest(), credential });
    expect(result.stopReason).toBe("refusal");
    expect(result.refusal).toEqual({ category: null, explanation: "I can't help with that." });
  });

  it("maps a content filter stop to a refusal", async () => {
    const { adapter: replaying } = adapterReplying(() => contentFilter);
    const result = await replaying.chat({ model: "m", request: sampleRequest(), credential });
    expect(result.stopReason).toBe("refusal");
    expect(result.refusal).toEqual({ category: "content_filter", explanation: null });
  });

  it("refuses arguments that are not JSON", async () => {
    const broken = structuredClone(toolCalls);
    const call = broken.choices[0]?.message.tool_calls?.[0];
    if (call) call.function.arguments = "{not json";
    const { adapter: replaying } = adapterReplying(() => broken);
    await expect(replaying.chat({ model: "m", request: sampleRequest(), credential })).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it("maps SDK errors by status", async () => {
    const failing = (error: Error) =>
      openaiAdapter({
        client: () => ({
          chat: {
            completions: {
              create: async () => {
                throw error;
              },
            },
          },
        }),
      }).chat({ model: "m", request: sampleRequest(), credential });
    await expect(failing(httpError(429, "slow down", { "retry-after-ms": "250" }))).rejects.toMatchObject({
      constructor: RateLimitError,
      retryAfterMs: 250,
    });
    await expect(failing(httpError(400, "bad"))).rejects.toBeInstanceOf(InvalidRequestError);
  });
});
