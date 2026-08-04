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
  };
}
