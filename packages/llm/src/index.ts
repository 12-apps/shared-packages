/**
 * `@12-apps/llm`: a provider-agnostic model connector.
 *
 * - `createModelClient` — the abstract factory (provider id → adapter).
 * - `createAdapterRegistry` / `builtInAdapters` — the registry a host extends.
 * - `anthropicAdapter`, `openaiAdapter`, `geminiAdapter` — the built-ins.
 * - `runToolLoop` — turns until the model stops calling tools.
 * - Credentials: `{ kind: "apiKey" }` or `{ kind: "oauth" }`.
 * - Typed errors and the `retryTransient` policy.
 */
export type { AdapterRegistry, ChatCall, ProviderAdapter, RegisterOptions } from "./adapter";
export { createAdapterRegistry } from "./adapter";
export {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  anthropicAdapter,
  builtInAdapters,
  geminiAdapter,
  openaiAdapter,
} from "./adapters";
export type {
  AnthropicAdapterOptions,
  AnthropicClientLike,
  GeminiAdapterOptions,
  GeminiClientLike,
  OpenAIAdapterOptions,
  OpenAIClientLike,
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
export type { LlmErrorKind } from "./errors";
export {
  AuthError,
  InvalidRequestError,
  InvalidResponseError,
  LlmError,
  ProviderUnavailableError,
  RateLimitError,
  RefusalError,
  UnsupportedError,
  mapProviderError,
  retryAfterFrom,
} from "./errors";
export type { ToolExecutor, ToolLoopOptions, ToolLoopResult, ToolLoopStatus, ToolOutput } from "./loop";
export { ensureNotRefused, runToolLoop } from "./loop";
export { assertStrictTools, strictSchemaProblems, toolSchemaProblems } from "./schema";
export type * from "./types";
