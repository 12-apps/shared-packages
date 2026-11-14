/**
 * The OpenAI adapter, over the official `openai` SDK's Chat Completions API
 * with function tools (an optional peer, imported only when this adapter
 * builds its own client).
 *
 * Mapping notes:
 * - System blocks become one system message, its text parts in order.
 *   OpenAI caches prompt prefixes by itself, so `cache` breakpoints and
 *   `cacheConversation` have nothing to map to; `cacheKey` becomes
 *   `prompt_cache_key`, which routes requests sharing a prefix together.
 * - Tools are sent with `strict: true`; arguments come back as JSON text and
 *   are parsed here.
 * - `effort` becomes `reasoning_effort`; `temperature` is passed when given.
 * - Usage: `prompt_tokens` includes the cached tokens, so `inputTokens` is
 *   the prompt minus the cache reads and writes.
 * - Credentials: API keys only. OpenAI's API authenticates with keys, and a
 *   ChatGPT or Codex sign-in is not a credential a third-party product may
 *   use (see the README's terms note).
 */
import type OpenAI from "openai";

import type { ChatCall, ProviderAdapter } from "../adapter";
import type { ResolvedCredential } from "../credentials";
import { InvalidResponseError, mapProviderError } from "../errors";
import type { ChatResult, Message, StopReason, ToolCall, Usage } from "../types";
import { loadSdk } from "./load";
import { count, refusalOf } from "./util";

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Completion = OpenAI.Chat.Completions.ChatCompletion;
type CompletionMessage = OpenAI.Chat.Completions.ChatCompletionMessage;
type FunctionToolCall = OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

export const OPENAI_PROVIDER = "openai";

/**
 * The slice of the SDK client this adapter calls. `params` is the SDK's
 * `ChatCompletionCreateParamsNonStreaming`, typed `never` here so this
 * package's public types do not require the optional SDK to be installed.
 */
export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: never, options?: { signal?: AbortSignal }): Promise<unknown>;
    };
  };
}

export interface OpenAIAdapterOptions {
  /** Build the SDK client for one call (tests inject a recording fake). */
  client?: (credential: ResolvedCredential) => OpenAIClientLike | Promise<OpenAIClientLike>;
  baseURL?: string;
  /** The `fetch` the SDK sends with (a proxy, a test double). */
  fetch?: typeof globalThis.fetch;
  defaultModel?: string;
}

async function defaultClient(credential: ResolvedCredential, options: OpenAIAdapterOptions): Promise<OpenAIClientLike> {
  const sdk = await loadSdk(OPENAI_PROVIDER, "openai", () => import("openai"));
  return new sdk.default({ apiKey: credential.secret, baseURL: options.baseURL, fetch: options.fetch, maxRetries: 0 });
}

const ERROR_PREFIX = "[tool error] ";

function toMessages(messages: readonly Message[]): ChatMessageParam[] {
  return messages.flatMap((message): ChatMessageParam[] => {
    if (message.role === "user") return [{ role: "user", content: message.text }];
    if (message.role === "assistant") {
      const toolCalls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
      }));
      return [{ role: "assistant", content: message.text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }];
    }
    return message.results.map((result) => ({
      role: "tool" as const,
      tool_call_id: result.callId,
      content: result.isError ? `${ERROR_PREFIX}${result.output}` : result.output,
    }));
  });
}

export function toOpenAIParams(call: ChatCall): ChatParams {
  const { request, model } = call;
  const messages: ChatMessageParam[] = [];
  if (request.system && request.system.length > 0) {
    messages.push({ role: "system", content: request.system.map((block) => ({ type: "text" as const, text: block.text })) });
  }
  messages.push(...toMessages(request.messages));
  const params: ChatParams = { model, messages, max_completion_tokens: request.maxOutputTokens };
  if (request.tools && request.tools.length > 0) {
    params.tools = request.tools.map((tool) => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true },
    }));
  }
  if (request.toolChoice) params.tool_choice = request.toolChoice;
  if (request.effort) params.reasoning_effort = request.effort;
  if (request.temperature !== undefined) params.temperature = request.temperature;
  if (request.cacheKey) params.prompt_cache_key = request.cacheKey;
  return params;
}

const STOP_REASONS: Record<string, StopReason> = {
  stop: "end",
  tool_calls: "tool_use",
  function_call: "tool_use",
  length: "max_tokens",
  content_filter: "refusal",
};

function toUsage(usage: Completion["usage"]): Usage {
  const details = usage?.prompt_tokens_details;
  const cacheRead = count(details?.cached_tokens);
  const cacheWrite = count(details?.cache_write_tokens);
  return {
    inputTokens: Math.max(0, count(usage?.prompt_tokens) - cacheRead - cacheWrite),
    cacheCreationTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    outputTokens: count(usage?.completion_tokens),
    raw: usage ?? null,
  };
}

function parseArguments(call: FunctionToolCall): unknown {
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    throw new InvalidResponseError(OPENAI_PROVIDER, `Tool call ${call.id} (${call.function.name}) carries arguments that are not JSON.`);
  }
}

function toolCallsOf(message: CompletionMessage): ToolCall[] {
  return (message.tool_calls ?? [])
    .filter((call): call is FunctionToolCall => call.type === "function")
    .map((call) => ({ id: call.id, name: call.function.name, input: parseArguments(call) }));
}

/** A refusal is the message's own `refusal` text, or a content-filter stop. */
function refusalText(message: CompletionMessage): string | null {
  return typeof message.refusal === "string" && message.refusal.length > 0 ? message.refusal : null;
}

function fromOpenAICompletion(response: Completion, model: string): ChatResult {
  const choice = response?.choices?.[0];
  if (!choice) throw new InvalidResponseError(OPENAI_PROVIDER, "The response carries no choice.");
  const { message } = choice;
  const toolCalls = toolCallsOf(message);
  const refused = refusalText(message);
  const stopReason: StopReason = refused ? "refusal" : (STOP_REASONS[choice.finish_reason] ?? "other");
  const text = message.content ?? "";
  return {
    provider: OPENAI_PROVIDER,
    model: response.model || model,
    text,
    toolCalls,
    stopReason,
    providerStopReason: choice.finish_reason ?? null,
    refusal: refused ? refusalOf(stopReason, null, refused) : refusalOf(stopReason, choice.finish_reason, null),
    usage: toUsage(response.usage),
    message: { role: "assistant", text, toolCalls, raw: { provider: OPENAI_PROVIDER, content: message } },
  };
}

export function openaiAdapter(options: OpenAIAdapterOptions = {}): ProviderAdapter {
  const build = options.client ?? ((credential: ResolvedCredential) => defaultClient(credential, options));
  return {
    id: OPENAI_PROVIDER,
    defaultModel: options.defaultModel,
    capabilities: ["chat"],
    credentialKinds: ["apiKey"],
    async chat(call) {
      const params = toOpenAIParams(call);
      const client = await build(call.credential);
      let response: unknown;
      try {
        response = await client.chat.completions.create(params as never, call.request.signal ? { signal: call.request.signal } : undefined);
      } catch (error) {
        throw mapProviderError(OPENAI_PROVIDER, error, [call.credential.secret]);
      }
      return fromOpenAICompletion(response as Completion, call.model);
    },
  };
}
