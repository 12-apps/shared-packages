/**
 * The abstract factory: `createModelClient` picks an adapter by provider id
 * and wraps it with what every provider shares: the credential strategy
 * (including the OAuth refresh on near-expiry and the single retry after a
 * 401), the strict tool-schema check, and the host's retry policy.
 */
import type { AdapterRegistry, ProviderAdapter } from "./adapter";
import { createAdapterRegistry } from "./adapter";
import { builtInAdapters } from "./adapters";
import type { CredentialSession, Credentials, ResolvedCredential } from "./credentials";
import { createCredentialSession } from "./credentials";
import { AuthError, InvalidRequestError, LlmError, UnsupportedError } from "./errors";
import { toolSchemaProblems } from "./schema";
import type { Capability, ChatRequest, ChatResult } from "./types";

/**
 * The host's ONE retry policy. Called after each failed attempt with the
 * typed error and the attempt number (1 for the first failure). Return a
 * delay in milliseconds to try again, or `null` to give up and throw.
 * The package itself never retries (the SDKs' own retries are switched off),
 * so this hook is the whole policy. A 401 under OAuth is not seen here: the
 * client refreshes and retries it once by itself.
 */
export type RetryPolicy = (error: LlmError, attempt: number) => number | null;

export interface ModelClientOptions {
  provider: string;
  /** Defaults to the adapter's default model. */
  model?: string;
  credentials: Credentials;
  retry?: RetryPolicy;
  /** Where to find adapters. Defaults to a registry of the built-in three. */
  registry?: AdapterRegistry;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ModelClient {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: readonly Capability[];
  supports(capability: Capability): boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** Retries rate limits and outages, honouring retry-after; gives up after `maxAttempts`. */
export function retryTransient(options: { maxAttempts?: number; baseDelayMs?: number } = {}): RetryPolicy {
  const maxAttempts = options.maxAttempts ?? 3;
  const base = options.baseDelayMs ?? 1000;
  return (error, attempt) => {
    if (attempt >= maxAttempts) return null;
    if (error.kind === "rate_limit") {
      const hinted = (error as { retryAfterMs?: number }).retryAfterMs;
      return hinted ?? base * 2 ** (attempt - 1);
    }
    return error.kind === "unavailable" ? base * 2 ** (attempt - 1) : null;
  };
}

const neverRetry: RetryPolicy = () => null;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function checkRequest(adapter: ProviderAdapter, request: ChatRequest): void {
  const problems = toolSchemaProblems(request.tools ?? []);
  if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    problems.push("maxOutputTokens must be a positive integer");
  }
  if (problems.length > 0) {
    throw new InvalidRequestError(adapter.id, `Invalid chat request:\n- ${problems.join("\n- ")}`);
  }
}

async function callWithAuth(
  adapter: ProviderAdapter,
  session: CredentialSession,
  model: string,
  request: ChatRequest,
): Promise<ChatResult> {
  const credential: ResolvedCredential = await session.current();
  try {
    return await adapter.chat({ model, request, credential });
  } catch (error) {
    if (!(error instanceof AuthError) || error.status !== 401) throw error;
    const renewed = await session.afterUnauthorized();
    if (!renewed) throw error;
    return adapter.chat({ model, request, credential: renewed });
  }
}

export function createModelClient(options: ModelClientOptions): ModelClient {
  const registry = options.registry ?? createAdapterRegistry(builtInAdapters());
  const adapter = registry.get(options.provider);
  if (!adapter.credentialKinds.includes(options.credentials.kind)) {
    throw new UnsupportedError(
      adapter.id,
      `The "${adapter.id}" adapter does not accept "${options.credentials.kind}" credentials (it accepts: ${adapter.credentialKinds.join(", ")}).`,
    );
  }
  const session = createCredentialSession(options.credentials, { now: options.now });
  const model = options.model ?? adapter.defaultModel;
  if (!model) {
    throw new InvalidRequestError(adapter.id, `The "${adapter.id}" adapter has no default model; pass \`model\`.`);
  }
  const retry = options.retry ?? neverRetry;
  const sleep = options.sleep ?? defaultSleep;

  return {
    provider: adapter.id,
    model,
    capabilities: adapter.capabilities,
    supports: (capability) => adapter.capabilities.includes(capability),
    async chat(request) {
      checkRequest(adapter, request);
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await callWithAuth(adapter, session, request.model ?? model, request);
        } catch (error) {
          if (!(error instanceof LlmError)) throw error;
          const delay = retry(error, attempt);
          if (delay === null || request.signal?.aborted) throw error;
          await sleep(delay);
        }
      }
    },
  };
}
