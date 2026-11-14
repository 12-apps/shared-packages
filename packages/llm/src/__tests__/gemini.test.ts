import { describe, expect, it } from "vitest";

import { geminiAdapter, toGeminiParams } from "../adapters/gemini";
import { ResolvedCredential } from "../credentials";
import { AuthError } from "../errors";
import functionCall from "./fixtures/gemini/function-call.response.json";
import promptBlocked from "./fixtures/gemini/prompt-blocked.response.json";
import safety from "./fixtures/gemini/safety.response.json";
import { httpError, sampleRequest } from "./helpers";

const credential = new ResolvedCredential("oauth", "ya29.test-access-token");

function adapterReplying(reply: () => unknown) {
  const sent: unknown[] = [];
  const adapter = geminiAdapter({
    client: () => ({
      models: {
        generateContent: async (params) => {
          sent.push(params);
          return reply();
        },
      },
    }),
  });
  return { adapter, sent };
}

describe("gemini adapter: the request", () => {
  it("maps system parts, contents, JSON-schema function declarations and the hints", () => {
    const params = toGeminiParams({ model: "gemini-fixture-1", request: sampleRequest({ toolChoice: "required", temperature: 0.4 }), credential });
    expect(params.model).toBe("gemini-fixture-1");
    expect(params.contents).toEqual([
      { role: "user", parts: [{ text: "Do you have pizza?" }] },
      {
        role: "model",
        parts: [{ text: "Checking." }, { functionCall: { id: "call_1", name: "search_menu", args: { query: "pizza", limit: null } } }],
      },
      { role: "user", parts: [{ functionResponse: { id: "call_1", name: "search_menu", response: { output: "2 results" } } }] },
      { role: "user", parts: [{ text: "Which ones?" }] },
    ]);
    expect(params.config).toEqual({
      maxOutputTokens: 1024,
      systemInstruction: { parts: [{ text: "You answer questions about one store." }, { text: "CATALOG: two pizzas." }] },
      tools: [
        {
          functionDeclarations: [
            { name: "search_menu", description: "Search the catalog by free text.", parametersJsonSchema: sampleRequest().tools?.[0]?.inputSchema },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
      thinkingConfig: { thinkingLevel: "LOW" },
      temperature: 0.4,
    });
  });

  it("replays its own raw turn, thought signature and all", () => {
    const raw = functionCall.candidates[0]?.content;
    const request = sampleRequest({
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "", toolCalls: [], raw: { provider: "gemini", content: raw } },
      ],
    });
    expect(toGeminiParams({ model: "m", request, credential }).contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      raw,
    ]);
  });
});

describe("gemini adapter: the response", () => {
  it("normalizes function calls and usage (cache reads, thinking billed as output)", async () => {
    const { adapter: replaying, sent } = adapterReplying(() => functionCall);
    const result = await replaying.chat({ model: "m", request: sampleRequest(), credential });
    expect(sent).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
    expect(result.text).toBe("Let me check the menu.");
    expect(result.toolCalls).toEqual([{ id: "fc_fixture_1", name: "search_menu", input: { query: "pizza", limit: null } }]);
    expect(result.usage).toMatchObject({ inputTokens: 152, cacheCreationTokens: 0, cacheReadTokens: 2048, outputTokens: 84 });
    expect(result.model).toBe("gemini-fixture-1");
  });

  it("maps a SAFETY finish to a refusal", async () => {
    const { adapter: replaying } = adapterReplying(() => safety);
    const result = await replaying.chat({ model: "m", request: sampleRequest(), credential });
    expect(result.stopReason).toBe("refusal");
    expect(result.refusal).toEqual({ category: "SAFETY", explanation: null });
  });

  it("maps a blocked prompt to a refusal", async () => {
    const { adapter: replaying } = adapterReplying(() => promptBlocked);
    const result = await replaying.chat({ model: "m", request: sampleRequest(), credential });
    expect(result.stopReason).toBe("refusal");
    expect(result.refusal).toEqual({ category: "PROHIBITED_CONTENT", explanation: "The prompt was blocked." });
    expect(result.toolCalls).toEqual([]);
  });

  it("maps a 401 to an auth error without the token in the message", async () => {
    const failingAdapter = geminiAdapter({
      client: () => ({
        models: {
          generateContent: async () => {
            throw httpError(401, "token ya29.test-access-token expired");
          },
        },
      }),
    });
    const error = await failingAdapter.chat({ model: "m", request: sampleRequest(), credential }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as Error).message).not.toContain("ya29.test-access-token");
  });
});
