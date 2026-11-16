/**
 * The adapter port and the registry the factory picks adapters from.
 *
 * An adapter is the ONLY place a provider's API shape lives. It declares what
 * it can do (`capabilities`) and which credential strategies its provider
 * accepts (`credentialKinds`), and turns one `ChatRequest` into one
 * `ChatResult` with the credential it is handed. Retry, OAuth refresh and the
 * strict-schema check are the client's, so an adapter never repeats them.
 */
import type { CredentialKind, ResolvedCredential } from "./credentials";
import { UnsupportedError } from "./errors";
import type { Capability, ChatRequest, ChatResult } from "./types";

/** What the client hands an adapter for one call. */
export interface ChatCall {
  model: string;
  request: ChatRequest;
  credential: ResolvedCredential;
}

export interface ProviderAdapter {
  /** The provider id a host names in `createModelClient({ provider })`. */
  readonly id: string;
  /** Used when the host names no model; an adapter may ship none. */
  readonly defaultModel?: string;
  readonly capabilities: readonly Capability[];
  readonly credentialKinds: readonly CredentialKind[];
  /**
   * Run one chat turn. Throws the package's typed errors (map an SDK failure
   * with `mapProviderError`); a refusal is a RESULT, not an error.
   */
  chat(call: ChatCall): Promise<ChatResult>;
}

export interface RegisterOptions {
  /** Replace an adapter already registered under the same id. */
  replace?: boolean;
}

export interface AdapterRegistry {
  register(adapter: ProviderAdapter, options?: RegisterOptions): AdapterRegistry;
  get(id: string): ProviderAdapter;
  has(id: string): boolean;
  ids(): string[];
}

/**
 * A registry of adapters, keyed by provider id. A host adds its own adapter
 * (or replaces a built-in one, say with a different base URL) with
 * `register`, without touching this package.
 */
export function createAdapterRegistry(adapters: readonly ProviderAdapter[] = []): AdapterRegistry {
  const byId = new Map<string, ProviderAdapter>();
  const registry: AdapterRegistry = {
    register(adapter, options = {}) {
      if (byId.has(adapter.id) && !options.replace) {
        throw new TypeError(
          `@12-apps/llm: an adapter for "${adapter.id}" is already registered; pass { replace: true } to replace it.`,
        );
      }
      byId.set(adapter.id, adapter);
      return registry;
    },
    get(id) {
      const adapter = byId.get(id);
      if (!adapter) {
        throw new UnsupportedError(id, `No adapter is registered for provider "${id}" (registered: ${[...byId.keys()].join(", ") || "none"}).`);
      }
      return adapter;
    },
    has: (id) => byId.has(id),
    ids: () => [...byId.keys()],
  };
  for (const adapter of adapters) registry.register(adapter);
  return registry;
}
