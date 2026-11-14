/**
 * The Anthropic adapter, over the official `@anthropic-ai/sdk` (an optional
 * peer, imported only when this adapter builds its own client).
 *
 * Mapping notes:
 * - System blocks keep their order; a block marked `cache` carries a
 *   `cache_control` breakpoint. Tools render before the system prompt, so the
 *   first breakpoint also caches the tool list. At most four breakpoints in
 *   all, `cacheConversation` included (the API's limit).
 * - Tools are sent with `strict: true`. `toolChoice: "required"` becomes
 *   `{ type: "any" }`, which some models refuse: steer with the prompt there.
 * - `effort` becomes `output_config.effort`. `temperature` is dropped: the
 *   current Messages API refuses sampling parameters.
 * - An assistant turn this adapter produced is replayed from `raw`, so
 *   thinking blocks go back unchanged inside a tool loop.
 */
import type Anthropic from "@anthropic-ai/sdk";

import type { ChatCall, ProviderAdapter } from "../adapter";
import type { ResolvedCredential } from "../credentials";
import { InvalidRequestError, InvalidResponseError, mapProviderError } from "../errors";
import type { ChatResult, Message, StopReason, SystemBlock, ToolCall, Usage } from "../types";
import { loadSdk } from "./load";
import { count, refusalOf } from "./util";

export const ANTHROPIC_PROVIDER = "anthropic";
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";
const OAUTH_BETA = "oauth-2025-04-20";
const MAX_BREAKPOINTS = 4;

/**
 * The slice of the SDK client this adapter calls. `params` is the SDK's
 * `MessageCreateParamsNonStreaming`; it is typed `never` here so this
 * package's public types do not require the optional SDK to be installed.
 */
export interface AnthropicClientLike {
  messages: {
    create(params: never, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

export interface AnthropicAdapterOptions {
  /** Build the SDK client for one call (tests inject a recording fake). */
  client?: (credential: ResolvedCredential) => AnthropicClientLike | Promise<AnthropicClientLike>;
  baseURL?: string;
  /** The `fetch` the SDK sends with (a proxy, a test double). */
  fetch?: typeof globalThis.fetch;
  defaultModel?: string;
}

async function defaultClient(credential: ResolvedCredential, options: AnthropicAdapterOptions): Promise<AnthropicClientLike> {
  const sdk = await loadSdk(ANTHROPIC_PROVIDER, "@anthropic-ai/sdk", () => import("@anthropic-ai/sdk"));
  const Client = sdk.default;
  // Exactly one credential option is passed, so the SDK reads none from the environment.
  const common = { baseURL: options.baseURL, fetch: options.fetch, maxRetries: 0 };
  return credential.kind === "apiKey"
    ? new Client({ ...common, apiKey: credential.secret })
    : new Client({ ...common, authToken: credential.secret, defaultHeaders: { "anthropic-beta": OAUTH_BETA } });
}

function cacheControl(cache: SystemBlock["cache"]): Anthropic.CacheControlEphemeral | undefined {
  if (!cache) return undefined;
  return cache === true ? { type: "ephemeral" } : { type: "ephemeral", ttl: cache.ttl };
}

function toSystem(blocks: readonly SystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks.map((block) => {
    const control = cacheControl(block.cache);
    return control ? { type: "text", text: block.text, cache_control: control } : { type: "text", text: block.text };
  });
}

function assistantContent(message: Extract<Message, { role: "assistant" }>): Anthropic.ContentBlockParam[] {
  if (message.raw?.provider === ANTHROPIC_PROVIDER && Array.isArray(message.raw.content)) {
    return message.raw.content as Anthropic.ContentBlockParam[];
  }
  const blocks: Anthropic.ContentBlockParam[] = message.text ? [{ type: "text", text: message.text }] : [];
  for (const call of message.toolCalls) {
    blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
  }
  return blocks;
}

function toMessages(messages: readonly Message[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === "user") return { role: "user", content: message.text };
    if (message.role === "assistant") return { role: "assistant", content: assistantContent(message) };
    return {
      role: "user",
      content: message.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.callId,
        content: result.output,
        ...(result.isError ? { is_error: true } : {}),
      })),
    };
  });
}

function toToolChoice(choice: ChatCall["request"]["toolChoice"]): Anthropic.ToolChoice | undefined {
  if (choice === "none") return { type: "none" };
  if (choice === "required") return { type: "any" };
  return choice === "auto" ? { type: "auto" } : undefined;
}

export function toAnthropicParams(call: ChatCall): Anthropic.MessageCreateParamsNonStreaming {
  const { request, model } = call;
  const system = request.system ?? [];
  const breakpoints = system.filter((block) => block.cache).length + (request.cacheConversation ? 1 : 0);
  if (breakpoints > MAX_BREAKPOINTS) {
    throw new InvalidRequestError(ANTHROPIC_PROVIDER, `At most ${MAX_BREAKPOINTS} cache breakpoints per request; this one has ${breakpoints}.`);
  }
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: request.maxOutputTokens,
    messages: toMessages(request.messages),
  };
  if (system.length > 0) params.system = toSystem(system);
  if (request.tools && request.tools.length > 0) {
    params.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      strict: true,
    }));
  }
  const toolChoice = toToolChoice(request.toolChoice);
  if (toolChoice) params.tool_choice = toolChoice;
  if (request.effort) params.output_config = { effort: request.effort };
  if (request.cacheConversation) params.cache_control = { type: "ephemeral" };
  return params;
}

const STOP_REASONS: Record<string, StopReason> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  model_context_window_exceeded: "max_tokens",
  refusal: "refusal",
};

function toUsage(usage: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: count(usage?.input_tokens),
    cacheCreationTokens: count(usage?.cache_creation_input_tokens),
    cacheReadTokens: count(usage?.cache_read_input_tokens),
    outputTokens: count(usage?.output_tokens),
    raw: usage ?? null,
  };
}

function textOf(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function toolCallsOf(content: readonly Anthropic.ContentBlock[]): ToolCall[] {
  return content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
}

function stopReasonOf(reason: string | null): StopReason {
  return (reason && STOP_REASONS[reason]) || "other";
}

function refusalDetails(details: Anthropic.RefusalStopDetails | null | undefined): [string | null, string | null] {
  return [details?.category ?? null, details?.explanation ?? null];
}

function fromAnthropicMessage(response: Anthropic.Message, model: string): ChatResult {
  if (!response || !Array.isArray(response.content)) {
    throw new InvalidResponseError(ANTHROPIC_PROVIDER, "The response carries no content array.");
  }
  const text = textOf(response.content);
  const toolCalls = toolCallsOf(response.content);
  const providerStopReason = response.stop_reason ?? null;
  const stopReason = stopReasonOf(providerStopReason);
  return {
    provider: ANTHROPIC_PROVIDER,
    model: response.model || model,
    text,
    toolCalls,
    stopReason,
    providerStopReason,
    refusal: refusalOf(stopReason, ...refusalDetails(response.stop_details)),
    usage: toUsage(response.usage),
    message: { role: "assistant", text, toolCalls, raw: { provider: ANTHROPIC_PROVIDER, content: response.content } },
  };
}

export function anthropicAdapter(options: AnthropicAdapterOptions = {}): ProviderAdapter {
  const build = options.client ?? ((credential: ResolvedCredential) => defaultClient(credential, options));
  return {
    id: ANTHROPIC_PROVIDER,
    defaultModel: options.defaultModel ?? ANTHROPIC_DEFAULT_MODEL,
    capabilities: ["chat"],
    credentialKinds: ["apiKey", "oauth"],
    async chat(call) {
      const params = toAnthropicParams(call);
      const client = await build(call.credential);
      let response: unknown;
      try {
        response = await client.messages.create(params as never, call.request.signal ? { signal: call.request.signal } : undefined);
      } catch (error) {
        throw mapProviderError(ANTHROPIC_PROVIDER, error, [call.credential.secret]);
      }
      return fromAnthropicMessage(response as Anthropic.Message, call.model);
    },
  };
}
