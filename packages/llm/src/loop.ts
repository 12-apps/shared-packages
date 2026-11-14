/**
 * The tool-use loop: run turns until the model stops calling tools, refuses,
 * runs out of output budget, or the turn limit is reached.
 *
 * The host supplies an executor per tool name and a usage callback; every
 * turn's normalized usage is reported through it, before anything else
 * happens with that turn, so a host meters cost even for a turn that ends the
 * loop. A refusal is a typed RESULT (`status: "refused"`), never an error, so
 * the host can hand the conversation to a person.
 */
import type { ModelClient } from "./client";
import { RefusalError } from "./errors";
import type { AssistantMessage, ChatRequest, ChatResult, Message, Refusal, ToolCall, ToolResult, Usage } from "./types";

/** What an executor returns: the output text, or the text marked as an error. */
export type ToolOutput = string | { output: string; isError?: boolean };

export type ToolExecutor = (input: unknown, context: { call: ToolCall; turn: number }) => Promise<ToolOutput> | ToolOutput;

export interface ToolLoopOptions {
  client: ModelClient;
  /** The first turn's request. `messages` is the conversation so far. */
  request: ChatRequest;
  executors: Readonly<Record<string, ToolExecutor>>;
  /** Turns at most, each turn being one model call. Default 8. */
  maxTurns?: number;
  /** Called once per turn with that turn's usage, turn numbers from 1. */
  onUsage?: (usage: Usage, turn: number, result: ChatResult) => void | Promise<void>;
}

export type ToolLoopStatus = "completed" | "refused" | "max_turns" | "max_tokens" | "stopped";

export interface ToolLoopResult {
  status: ToolLoopStatus;
  /** The conversation, with every turn and tool result appended. */
  messages: Message[];
  /** The last model turn. */
  final: ChatResult;
  turns: number;
  /** The sum of every turn's usage (without the raw objects). */
  usage: Omit<Usage, "raw">;
  /** Set when `status` is "refused". */
  refusal: Refusal | null;
}

const UNKNOWN_TOOL = "This tool does not exist.";

function addUsage(total: Omit<Usage, "raw">, usage: Usage): Omit<Usage, "raw"> {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    cacheCreationTokens: total.cacheCreationTokens + usage.cacheCreationTokens,
    cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
  };
}

async function runCall(call: ToolCall, turn: number, executors: ToolLoopOptions["executors"]): Promise<ToolResult> {
  const executor = Object.hasOwn(executors, call.name) ? executors[call.name] : undefined;
  if (!executor) return { callId: call.id, name: call.name, output: UNKNOWN_TOOL, isError: true };
  try {
    const out = await executor(call.input, { call, turn });
    return typeof out === "string"
      ? { callId: call.id, name: call.name, output: out }
      : { callId: call.id, name: call.name, output: out.output, ...(out.isError ? { isError: true } : {}) };
  } catch (error) {
    // The model gets the failure as an error result and may recover from it.
    const message = error instanceof Error ? error.message : String(error);
    return { callId: call.id, name: call.name, output: message, isError: true };
  }
}

function statusOf(result: ChatResult): ToolLoopStatus | null {
  if (result.stopReason === "refusal") return "refused";
  if (result.stopReason === "max_tokens") return "max_tokens";
  if (result.toolCalls.length === 0) return result.stopReason === "end" ? "completed" : "stopped";
  return null;
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxTurns = options.maxTurns ?? 8;
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new TypeError("@12-apps/llm: maxTurns must be a positive integer.");
  const messages: Message[] = [...options.request.messages];
  let usage: Omit<Usage, "raw"> = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

  for (let turn = 1; ; turn += 1) {
    const final = await options.client.chat({ ...options.request, messages: [...messages] });
    usage = addUsage(usage, final.usage);
    await options.onUsage?.(final.usage, turn, final);
    const assistant: AssistantMessage = final.message;
    messages.push(assistant);

    const status = statusOf(final);
    if (status) return { status, messages, final, turns: turn, usage, refusal: final.refusal };
    if (turn >= maxTurns) return { status: "max_turns", messages, final, turns: turn, usage, refusal: null };

    const results = await Promise.all(final.toolCalls.map((call) => runCall(call, turn, options.executors)));
    messages.push({ role: "tool", results });
  }
}

/** Throw a `RefusalError` when a turn was refused; return it otherwise. */
export function ensureNotRefused(result: ChatResult): ChatResult {
  if (result.stopReason === "refusal") {
    throw new RefusalError(result.provider, result.refusal ?? { category: null, explanation: null });
  }
  return result;
}
