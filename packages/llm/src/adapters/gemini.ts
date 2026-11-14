/**
 * The Gemini adapter, over the official Google GenAI SDK (`@google/genai`, an
 * optional peer, imported only when this adapter builds its own client).
 *
 * Mapping notes:
 * - System blocks become `systemInstruction` parts, in order. The Gemini API
 *   caches repeated prefixes implicitly; explicit cached contents are a
 *   separate resource this adapter does not manage, so `cache` breakpoints,
 *   `cacheConversation` and `cacheKey` have nothing to map to.
 * - Tools become function declarations with `parametersJsonSchema` (JSON
 *   Schema, `additionalProperties` included). `toolChoice` becomes the
 *   function-calling mode (`required` is `ANY`).
 * - `effort` becomes `thinkingConfig.thinkingLevel`; `temperature` is passed.
 * - Usage: `promptTokenCount` includes the cached tokens; output counts the
 *   candidates plus the thinking tokens, which Gemini bills as output.
 * - A model turn this adapter produced is replayed from `raw`, so thought
 *   signatures go back unchanged inside a tool loop.
 * - Credentials: an API key, or a Google OAuth access token for the Gemini
 *   API (Google's own OAuth, which its terms allow for this API).
 */
import type { Content, GenerateContentParameters, GenerateContentResponse, Part } from "@google/genai";

import type { ChatCall, ProviderAdapter } from "../adapter";
import type { ResolvedCredential } from "../credentials";
import { InvalidRequestError, InvalidResponseError, mapProviderError } from "../errors";
import type { ChatResult, Effort, Message, StopReason, ToolCall, ToolChoice, Usage } from "../types";
import { loadSdk } from "./load";
import { count, refusalOf } from "./util";

export const GEMINI_PROVIDER = "gemini";

/**
 * The slice of the SDK client this adapter calls. `params` is the SDK's
 * `GenerateContentParameters`, typed `never` here so this package's public
 * types do not require the optional SDK to be installed.
 */
export interface GeminiClientLike {
  models: {
    generateContent(params: never): Promise<unknown>;
  };
}

export interface GeminiAdapterOptions {
  /** Build the SDK client for one call (tests inject a recording fake). */
  client?: (credential: ResolvedCredential) => GeminiClientLike | Promise<GeminiClientLike>;
  baseURL?: string;
  /** The `fetch` the SDK sends with (a proxy, a test double). */
  fetch?: typeof globalThis.fetch;
  defaultModel?: string;
}

/** A google-auth `AuthClient` stand-in that only ever sends the host's token. */
function bearerAuthClient(token: string) {
  return { getRequestHeaders: async () => new Headers({ Authorization: `Bearer ${token}` }) };
}

async function defaultClient(credential: ResolvedCredential, options: GeminiAdapterOptions): Promise<GeminiClientLike> {
  const sdk = await loadSdk(GEMINI_PROVIDER, "@google/genai", () => import("@google/genai"));
  const httpOptions = { baseUrl: options.baseURL, fetch: options.fetch };
  if (credential.kind === "apiKey") return new sdk.GoogleGenAI({ apiKey: credential.secret, httpOptions });
  const client = new sdk.GoogleGenAI({
    httpOptions,
    googleAuthOptions: { authClient: bearerAuthClient(credential.secret) as never },
  });
  // The SDK falls back to GOOGLE_API_KEY / GEMINI_API_KEY when no key is
  // passed, and a key would be sent instead of the token: refuse that.
  if ((client as unknown as { apiKey?: string }).apiKey !== undefined) {
    throw new InvalidRequestError(GEMINI_PROVIDER, "An API key in the environment would replace the OAuth token; unset it or use apiKey credentials.");
  }
  return client;
}

function assistantContent(message: Extract<Message, { role: "assistant" }>): Content {
  if (message.raw?.provider === GEMINI_PROVIDER && message.raw.content && typeof message.raw.content === "object") {
    return message.raw.content as Content;
  }
  const parts: Part[] = message.text ? [{ text: message.text }] : [];
  for (const call of message.toolCalls) {
    parts.push({ functionCall: { id: call.id, name: call.name, args: (call.input ?? {}) as Record<string, unknown> } });
  }
  return { role: "model", parts };
}

function toContents(messages: readonly Message[]): Content[] {
  return messages.map((message): Content => {
    if (message.role === "user") return { role: "user", parts: [{ text: message.text }] };
    if (message.role === "assistant") return assistantContent(message);
    return {
      role: "user",
      parts: message.results.map((result) => ({
        functionResponse: {
          id: result.callId,
          name: result.name,
          response: result.isError ? { error: result.output } : { output: result.output },
        },
      })),
    };
  });
}

const MODES: Record<ToolChoice, string> = { auto: "AUTO", none: "NONE", required: "ANY" };
const LEVELS: Record<Effort, string> = { low: "LOW", medium: "MEDIUM", high: "HIGH" };

type GeminiConfig = NonNullable<GenerateContentParameters["config"]>;

export function toGeminiParams(call: ChatCall): GenerateContentParameters {
  const { request, model } = call;
  const config: GeminiConfig = { maxOutputTokens: request.maxOutputTokens };
  if (request.system && request.system.length > 0) {
    config.systemInstruction = { parts: request.system.map((block) => ({ text: block.text })) };
  }
  if (request.tools && request.tools.length > 0) {
    config.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.inputSchema,
        })),
      },
    ];
  }
  if (request.toolChoice) {
    config.toolConfig = { functionCallingConfig: { mode: MODES[request.toolChoice] as never } };
  }
  if (request.effort) config.thinkingConfig = { thinkingLevel: LEVELS[request.effort] as never };
  if (request.temperature !== undefined) config.temperature = request.temperature;
  if (request.signal) config.abortSignal = request.signal;
  return { model, contents: toContents(request.messages), config };
}

const REFUSALS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

function stopReasonOf(finish: string | undefined, hasCalls: boolean): StopReason {
  if (finish && REFUSALS.has(finish)) return "refusal";
  if (finish === "MAX_TOKENS") return "max_tokens";
  if (hasCalls) return "tool_use";
  return finish === "STOP" ? "end" : "other";
}

function toUsage(usage: GenerateContentResponse["usageMetadata"]): Usage {
  const cacheRead = count(usage?.cachedContentTokenCount);
  const prompt = count(usage?.promptTokenCount) + count(usage?.toolUsePromptTokenCount);
  return {
    inputTokens: Math.max(0, prompt - cacheRead),
    cacheCreationTokens: 0,
    cacheReadTokens: cacheRead,
    outputTokens: count(usage?.candidatesTokenCount) + count(usage?.thoughtsTokenCount),
    raw: usage ?? null,
  };
}

function textOf(parts: readonly Part[]): string {
  return parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");
}

function toolCallsOf(parts: readonly Part[]): ToolCall[] {
  return parts.flatMap((part, index): ToolCall[] => {
    const call = part.functionCall;
    if (!call) return [];
    return [{ id: call.id ?? `gemini_call_${index}`, name: call.name ?? "", input: call.args ?? {} }];
  });
}

/** Why the turn stopped: a blocked prompt first, then the candidate's finish reason. */
function stopOf(response: GenerateContentResponse, hasCalls: boolean): { stopReason: StopReason; provider: string | null } {
  const blocked = response.promptFeedback?.blockReason as string | undefined;
  if (blocked) return { stopReason: "refusal", provider: blocked };
  const finish = (response.candidates?.[0]?.finishReason as string | undefined) ?? null;
  return { stopReason: stopReasonOf(finish ?? undefined, hasCalls), provider: finish };
}

function fromGeminiResponse(response: GenerateContentResponse, model: string): ChatResult {
  if (!response || typeof response !== "object") {
    throw new InvalidResponseError(GEMINI_PROVIDER, "The response is empty.");
  }
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = textOf(parts);
  const toolCalls = toolCallsOf(parts);
  const { stopReason, provider } = stopOf(response, toolCalls.length > 0);
  const content: Content = { role: "model", parts };
  return {
    provider: GEMINI_PROVIDER,
    model: response.modelVersion || model,
    text,
    toolCalls,
    stopReason,
    providerStopReason: provider,
    refusal: refusalOf(stopReason, provider, response.promptFeedback?.blockReasonMessage ?? null),
    usage: toUsage(response.usageMetadata),
    message: { role: "assistant", text, toolCalls, raw: { provider: GEMINI_PROVIDER, content } },
  };
}

export function geminiAdapter(options: GeminiAdapterOptions = {}): ProviderAdapter {
  const build = options.client ?? ((credential: ResolvedCredential) => defaultClient(credential, options));
  return {
    id: GEMINI_PROVIDER,
    defaultModel: options.defaultModel,
    capabilities: ["chat"],
    credentialKinds: ["apiKey", "oauth"],
    async chat(call) {
      const params = toGeminiParams(call);
      const client = await build(call.credential);
      let response: unknown;
      try {
        response = await client.models.generateContent(params as never);
      } catch (error) {
        throw mapProviderError(GEMINI_PROVIDER, error, [call.credential.secret]);
      }
      return fromGeminiResponse(response as GenerateContentResponse, call.model);
    },
  };
}
