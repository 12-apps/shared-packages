/**
 * `@12-apps/llm`: a provider-agnostic model connector.
 *
 * - `createModelClient` — the abstract factory (provider id → adapter).
 * - `createAdapterRegistry` / `builtInAdapters` — the registry a host extends.
 * - `anthropicAdapter`, `openaiAdapter`, `geminiAdapter` — the built-ins.
 * - `runToolLoop` — turns until the model stops calling tools.
 * - Credentials: `{ kind: "apiKey" }` or `{ kind: "oauth" }`.
 * - Typed errors and the `retryTransient` policy.
 * - `createSupportLadder` — automation, model tiers, then a person; tools per
 *   tier (`mcpTools` for an MCP server's allow-listed ones), bound to a scope.
 */
export type { AdapterRegistry, ChatCall, ProviderAdapter, RegisterOptions } from "./adapter";
export { createAdapterRegistry } from "./adapter";
export {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  XAI_PROVIDER,
  anthropicAdapter,
  builtInAdapters,
  geminiAdapter,
  openaiAdapter,
  xaiAdapter,
} from "./adapters";
export type {
  AnthropicAdapterOptions,
  AnthropicClientLike,
  GeminiAdapterOptions,
  GeminiClientLike,
  OpenAIAdapterOptions,
  OpenAIClientLike,
  XaiAdapterOptions,
} from "./adapters";
export type { ModelClient, ModelClientOptions, RetryPolicy } from "./client";
export { createModelClient, retryTransient } from "./client";
export type {
  ApiKeyCredentials,
  CredentialKind,
  CredentialSession,
  CredentialSessionOptions,
  Credentials,
  OAuthCredentials,
  OAuthToken,
  RefreshReason,
} from "./credentials";
export { ResolvedCredential, createCredentialSession } from "./credentials";
export type { LlmErrorKind, SupportLadderErrorCode } from "./errors";
export {
  AuthError,
  CredentialRevokedError,
  InvalidRequestError,
  InvalidResponseError,
  LlmError,
  ProviderUnavailableError,
  RateLimitError,
  RefusalError,
  SupportLadderError,
  UnsupportedError,
  mapProviderError,
  retryAfterFrom,
} from "./errors";
export type { ToolExecutor, ToolLoopOptions, ToolLoopResult, ToolLoopStatus, ToolOutput } from "./loop";
export { ensureNotRefused, runToolLoop } from "./loop";
export type {
  Escalation,
  SupportAutomation,
  SupportHandOff,
  SupportLadder,
  SupportLadderOptions,
  SupportPerson,
  SupportRequest,
  SupportResult,
  SupportStatePort,
  SupportTier,
  TierUsage,
} from "./support/ladder";
export { WITH_PERSON, createSupportLadder } from "./support/ladder";
export type { McpClientLike, McpListToolsResult, McpToolInfo, McpToolsOptions } from "./support/mcp";
export { mcpResultToOutput, mcpTools } from "./support/mcp";
export type {
  EscalationRequest,
  EscalationTarget,
  SupportTool,
  SupportToolContext,
  SupportToolEntry,
  SupportToolSource,
} from "./support/tools";
export { ESCALATE_TOOL } from "./support/tools";
export { assertStrictTools, strictSchemaProblems, toolSchemaProblems } from "./schema";
export type * from "./types";
