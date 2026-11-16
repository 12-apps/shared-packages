/**
 * The tool-use loop: run turns until the model stops calling tools, refuses,
 * runs out of output budget, or the turn limit is reached.
 *
 * The host supplies an executor per tool name and a usage callback; every
 * turn's normalized usage is reported through it, before anything else
 * happens with that turn, so a host meters cost even for a turn that ends the
 * loop. A refusal is a typed RESULT (`status: "refused"`), never an error, so
 * the host can hand the conversation to a person.
 *
 * An executor may HALT the loop (`{ output, halt: true }`): the turn's tool
 * results are appended and the loop ends with `status: "halted"` without
 * another model call. A hand-off tool uses it to leave the conversation.
 *
 * The returned `messages` are always a valid request for the NEXT turn (B2):
 * a turn the loop ends on keeps its text but never a tool call that was not
 * run (no tool_use without its tool_result), and a turn with neither text nor
 * a tool call — an empty refusal — is not appended at all. Either would make
 * the provider reject the host's next request with a 400.
 */
import type { ModelClient } from "./client";
import { RefusalError } from "./errors";
import type { AssistantMessage, ChatRequest, ChatResult, Message, Refusal, ToolCall, ToolResult, Usage } from "./types";

/**
 * What an executor returns: the output text, or the text marked as an error.
 * `halt` ends the loop once this turn's calls have all run.
 */
export type ToolOutput = string | { output: string; isError?: boolean; halt?: boolean };

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

export type ToolLoopStatus = "completed" | "refused" | "max_turns" | "max_tokens" | "stopped" | "halted";

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

interface CallOutcome {
  result: ToolResult;
  halt: boolean;
}

async function runCall(call: ToolCall, turn: number, executors: ToolLoopOptions["executors"]): Promise<CallOutcome> {
  const executor = Object.hasOwn(executors, call.name) ? executors[call.name] : undefined;
  if (!executor) return { result: { callId: call.id, name: call.name, output: UNKNOWN_TOOL, isError: true }, halt: false };
  try {
    const out = await executor(call.input, { call, turn });
    if (typeof out === "string") return { result: { callId: call.id, name: call.name, output: out }, halt: false };
    const result = { callId: call.id, name: call.name, output: out.output, ...(out.isError ? { isError: true } : {}) };
    return { result, halt: out.halt === true };
  } catch (error) {
    // The model gets the failure as an error result and may recover from it.
    const message = error instanceof Error ? error.message : String(error);
    return { result: { callId: call.id, name: call.name, output: message, isError: true }, halt: false };
  }
}

/**
 * The turn the loop ENDS on, as it goes into the transcript: its words only.
 * Tool calls nobody will answer are dropped, and with them `raw`, which
 * carries the same calls in the provider's own blocks; a turn with no words
 * is left out.
 */
function settled(message: AssistantMessage): AssistantMessage | null {
  if (message.toolCalls.length === 0) return message.text.length > 0 ? message : null;
  return message.text.length > 0 ? { role: "assistant", text: message.text, toolCalls: [] } : null;
}

/** The loop's result, with the turn it ends on settled into the transcript. */
function ended(status: ToolLoopStatus, messages: Message[], final: ChatResult, turns: number, usage: Omit<Usage, "raw">): ToolLoopResult {
  const last = settled(final.message);
  if (last) messages.push(last);
  return { status, messages, final, turns, usage, refusal: status === "refused" ? final.refusal : null };
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
    const status = statusOf(final) ?? (turn >= maxTurns ? "max_turns" : null);
    if (status) return ended(status, messages, final, turn, usage);
    messages.push(final.message);

    const outcomes = await Promise.all(final.toolCalls.map((call) => runCall(call, turn, options.executors)));
    messages.push({ role: "tool", results: outcomes.map((outcome) => outcome.result) });
    // Every call of the turn is answered, so the transcript stays a valid request.
    if (outcomes.some((outcome) => outcome.halt)) return { status: "halted", messages, final, turns: turn, usage, refusal: null };
  }
}

/** Throw a `RefusalError` when a turn was refused; return it otherwise. */
export function ensureNotRefused(result: ChatResult): ChatResult {
  if (result.stopReason === "refusal") {
    throw new RefusalError(result.provider, result.refusal ?? { category: null, explanation: null });
  }
  return result;
}
