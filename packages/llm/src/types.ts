/**
 * The provider-agnostic vocabulary: one chat turn in, one normalized result
 * out. Every adapter maps this interface to its provider's API and back, so a
 * host writes its prompts, tools and metering once.
 */

/**
 * What a model client can do. Only `chat` ships today; a later capability
 * (speech-to-text, say) joins this union and an adapter declares it.
 */
export type Capability = "chat";

/** A cache lifetime hint. Providers that cache implicitly ignore it. */
export type CacheTtl = "5m" | "1h";

/**
 * One block of the system prompt. Order the blocks MOST STABLE FIRST: a
 * provider caches a prefix, so a block that changes invalidates every block
 * after it. `cache` marks a breakpoint at the END of this block: everything up
 * to and including it is written to the provider's prompt cache.
 */
export interface SystemBlock {
  text: string;
  cache?: boolean | { ttl: CacheTtl };
}

/** A JSON Schema object. Kept loose: the strict rules are checked at runtime. */
export type JsonSchema = Record<string, unknown>;

/**
 * A tool the model may call. `inputSchema` is a STRICT JSON schema: every
 * object sets `additionalProperties: false` and lists every property in
 * `required` (an optional field is a nullable type instead). That is the
 * common ground of the providers' strict modes, so the same definition is
 * strict everywhere (see `assertStrictSchema`).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** `required` makes the model call at least one tool this turn. */
export type ToolChoice = "auto" | "none" | "required";

/** A coarse reasoning-depth hint; each adapter maps it to its own knob. */
export type Effort = "low" | "medium" | "high";

/** A tool call the model asked for, its input already parsed from JSON. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** The host's answer to one tool call. */
export interface ToolResult {
  callId: string;
  /** The tool's name; some providers match results by name, not by id. */
  name: string;
  output: string;
  isError?: boolean;
}

export interface UserMessage {
  role: "user";
  text: string;
}

/**
 * A model turn. `raw` carries the provider's own content for this turn, which
 * an adapter of the SAME provider replays verbatim (thinking blocks and
 * signatures some providers require back in a tool loop); any other adapter
 * ignores it and rebuilds the turn from `text` and `toolCalls`.
 */
export interface AssistantMessage {
  role: "assistant";
  text: string;
  toolCalls: ToolCall[];
  raw?: { provider: string; content: unknown };
}

/** The results of the previous assistant turn's tool calls, all together. */
export interface ToolResultsMessage {
  role: "tool";
  results: ToolResult[];
}

export type Message = UserMessage | AssistantMessage | ToolResultsMessage;

/** One chat turn. */
export interface ChatRequest {
  /** Overrides the client's model for this call only. */
  model?: string;
  system?: SystemBlock[];
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  maxOutputTokens: number;
  effort?: Effort;
  /** A sampling hint; adapters whose API refuses sampling params drop it. */
  temperature?: number;
  /**
   * Ask the provider to also cache the conversation so far (a breakpoint on
   * the last message). Providers that cache implicitly ignore it.
   */
  cacheConversation?: boolean;
  /** A stable key that routes requests sharing a prefix to the same cache. */
  cacheKey?: string;
  signal?: AbortSignal;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

/**
 * Token usage of one turn. `inputTokens` counts only the input that was
 * neither written to nor read from the cache, so the four counters add up to
 * everything billed, and each can be priced at its own rate.
 */
export interface Usage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** The provider's usage object, untouched. */
  raw: unknown;
}

/** Why the provider declined, when it says. */
export interface Refusal {
  category: string | null;
  explanation: string | null;
}

/** One normalized turn result. */
export interface ChatResult {
  provider: string;
  model: string;
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** The provider's own stop reason, for logs. */
  providerStopReason: string | null;
  refusal: Refusal | null;
  usage: Usage;
  /** The turn as a message, ready to append to the conversation. */
  message: AssistantMessage;
}
