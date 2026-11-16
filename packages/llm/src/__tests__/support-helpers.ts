import { createAdapterRegistry } from "../adapter";
import type { ModelClient } from "../client";
import { createModelClient } from "../client";
import type { SupportStatePort } from "../support/ladder";
import type { ToolCall } from "../types";
import { scriptedAdapter, turnResult } from "./fake-adapter";

/** A model client for one tier, over its own scripted adapter. */
export function tierClient(id: string, script: Parameters<typeof scriptedAdapter>[0]) {
  const { adapter, calls } = scriptedAdapter(script, { id });
  const client = createModelClient({ provider: id, credentials: { kind: "apiKey", apiKey: "k" }, registry: createAdapterRegistry([adapter]) });
  return { client, calls };
}

/** The state port over a Map, so a test can read and seed it. */
export function memoryState(initial: Array<[string, string]> = []): SupportStatePort & { levels: Map<string, string> } {
  const levels = new Map(initial);
  return {
    levels,
    get: (conversationId) => levels.get(conversationId),
    set: (conversationId, level) => {
      levels.set(conversationId, level);
    },
  };
}

export const escalate = (to: string, reason: string): ToolCall => ({ id: `esc-${to}`, name: "escalate", input: { to, reason } });

export const toolCall = (name: string, input: unknown, id = `call-${name}`): ToolCall => ({ id, name, input });

/** A strict one-field tool schema. */
export function objectSchema(field: string) {
  return {
    type: "object",
    properties: { [field]: { type: "string" } },
    required: [field],
    additionalProperties: false,
  };
}

/**
 * A client that calls `call` on a user message and answers "done" once the
 * tool result is back, whatever other conversations run at the same time.
 */
export function reactiveClient(call: ToolCall): ModelClient {
  return {
    provider: "reactive",
    model: "reactive-model",
    capabilities: ["chat"],
    supports: () => true,
    chat: async (request) => turnResult(request.messages.at(-1)?.role === "tool" ? { text: "done" } : { toolCalls: [call] }, 0),
  };
}
