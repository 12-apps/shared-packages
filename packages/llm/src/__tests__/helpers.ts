import type { ChatRequest, ToolDefinition } from "../types";

/** A strict tool: every property required, the optional one nullable. */
export const searchMenu: ToolDefinition = {
  name: "search_menu",
  description: "Search the catalog by free text.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: ["integer", "null"] },
    },
    required: ["query", "limit"],
    additionalProperties: false,
  },
};

/** A conversation with one finished tool round, then a new question. */
export function sampleRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    system: [
      { text: "You answer questions about one store." },
      { text: "CATALOG: two pizzas.", cache: { ttl: "1h" } },
    ],
    messages: [
      { role: "user", text: "Do you have pizza?" },
      {
        role: "assistant",
        text: "Checking.",
        toolCalls: [{ id: "call_1", name: "search_menu", input: { query: "pizza", limit: null } }],
      },
      {
        role: "tool",
        results: [{ callId: "call_1", name: "search_menu", output: "2 results", isError: false }],
      },
      { role: "user", text: "Which ones?" },
    ],
    tools: [searchMenu],
    toolChoice: "auto",
    maxOutputTokens: 1024,
    effort: "low",
    ...overrides,
  };
}

/** An SDK error the way the official SDKs shape one: a status and headers. */
export function httpError(status: number, message: string, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(message), { status, headers: new Headers(headers) });
}
