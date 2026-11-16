import type { ChatCall, ProviderAdapter } from "../adapter";
import type { CredentialKind } from "../credentials";
import type { ChatResult, StopReason, ToolCall } from "../types";

interface ScriptedTurn {
  text?: string;
  toolCalls?: ToolCall[];
  stopReason?: StopReason;
  error?: Error;
}

/** A turn result as an adapter would build it, with distinct usage per turn. */
export function turnResult(turn: ScriptedTurn, index: number): ChatResult {
  const toolCalls = turn.toolCalls ?? [];
  const stopReason = turn.stopReason ?? (toolCalls.length > 0 ? "tool_use" : "end");
  const text = turn.text ?? "";
  return {
    provider: "fake",
    model: "fake-model",
    text,
    toolCalls,
    stopReason,
    providerStopReason: stopReason,
    refusal: stopReason === "refusal" ? { category: "test", explanation: "declined" } : null,
    usage: { inputTokens: 10 * (index + 1), cacheCreationTokens: 1, cacheReadTokens: 100, outputTokens: 5, raw: { turn: index } },
    message: { role: "assistant", text, toolCalls },
  };
}

/** An adapter that plays a script and records every call it was handed. */
export function scriptedAdapter(
  script: ScriptedTurn[],
  options: { id?: string; credentialKinds?: CredentialKind[]; defaultModel?: string } = {},
) {
  const calls: ChatCall[] = [];
  const adapter: ProviderAdapter = {
    id: options.id ?? "fake",
    defaultModel: options.defaultModel ?? "fake-model",
    capabilities: ["chat"],
    credentialKinds: options.credentialKinds ?? ["apiKey", "oauth"],
    async chat(call) {
      const index = calls.length;
      calls.push(call);
      const turn = script[Math.min(index, script.length - 1)];
      if (!turn) throw new Error("empty script");
      if (turn.error) throw turn.error;
      return turnResult(turn, index);
    },
  };
  return { adapter, calls };
}
