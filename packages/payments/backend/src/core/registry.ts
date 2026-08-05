import { UnknownProviderError } from './errors';
import type { PaymentProviderAdapter } from './provider';

/**
 * Provider registry. Mirrors `@12-apps/entitlements`' `defineFeatures` /
 * `@12-apps/rbac`'s `definePermissions`: the host passes a `const` map of
 * adapters, and the derived name union is a string literal type — so a typo'd
 * provider name fails typecheck in the host instead of resolving to "unknown
 * provider" at runtime.
 *
 * @example
 * const providers = defineProviders({
 *   stone: stoneProvider(),
 *   infinitepay: infinitePayProvider(),
 *   stripe: stripeProvider(),
 * } as const);
 * type AppProvider = (typeof providers.names)[number]; // 'stone' | ...
 */
export interface ProviderRegistry<P extends string = string> {
  readonly names: readonly P[];
  /** Throws {@link UnknownProviderError} for names outside the registry. */
  get(name: string): PaymentProviderAdapter;
  has(name: string): name is P;
  /**
   * The provider's URL spelling — the adapter's `urlSlug`, or its name when
   * none is declared. Unknown names pass through unchanged, so callers that
   * hold a placeholder never crash building a link.
   */
  urlSlugOf(name: string): string;
  /**
   * The provider a URL segment names. A registered adapter's `urlSlug` wins;
   * anything else — a provider's raw name, an unknown segment typed by hand —
   * comes back unchanged. The raw name deliberately stays a working alias so
   * links built before an adapter declared a slug do not 404, and unknown
   * segments are the caller's decision to make (a settings screen already has
   * to handle a provider the backend does not offer).
   */
  providerForUrlSlug(slug: string): string;
}

export function defineProviders<const M extends Record<string, PaymentProviderAdapter>>(
  adapters: M,
): ProviderRegistry<keyof M & string> {
  type P = keyof M & string;
  const names = Object.keys(adapters) as P[];
  const byName = new Map<string, PaymentProviderAdapter>(Object.entries(adapters));

  return {
    names,
    get(name) {
      const adapter = byName.get(name);
      if (!adapter) throw new UnknownProviderError(name);
      return adapter;
    },
    has(name): name is P {
      return byName.has(name);
    },
    urlSlugOf(name) {
      const adapter = byName.get(name);
      return adapter ? (adapter.urlSlug ?? adapter.name) : name;
    },
    providerForUrlSlug(slug) {
      for (const [name, adapter] of byName) {
        if ((adapter.urlSlug ?? adapter.name) === slug) return name;
      }
      return slug;
    },
  };
}
