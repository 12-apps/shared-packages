import { AdapterContractError, UnknownProviderError } from './errors';
import type { PaymentProviderAdapter } from './provider';

/**
 * Refuse an adapter whose payment-proof declaration is half-written (FUT-726).
 *
 * `verifyConfirmsPayment` says a PROCESSED delivery of this provider proves
 * money moved; `referenceOfDelivery` says WHICH charge it proves. With only the
 * first, reconciliation can never correlate a delivery, so every stranded
 * activation of that provider's merchants stops healing — and stops silently,
 * because "no proof found" is also what a genuinely unpaid charge looks like.
 * The type union rules the shape out at compile time; this is the same rule for
 * the shapes that reach a running host anyway (a JS caller, an `as` cast),
 * stated once at registration, where it costs a failed boot instead of months
 * of unnoticed non-healing.
 */
function assertPaymentProofPaired(name: string, adapter: PaymentProviderAdapter): void {
  if (adapter.verifyConfirmsPayment && !adapter.referenceOfDelivery) {
    throw new AdapterContractError(
      name,
      'declares verifyConfirmsPayment without referenceOfDelivery, so a processed ' +
        'delivery could never be correlated to the charge it proves',
    );
  }
}

/**
 * Provider registry. Mirrors `@12-apps/entitlements`' `defineFeatures` /
 * `@12-apps/rbac`'s `definePermissions`: the host passes a `const` map of
 * adapters, and the derived name union is a string literal type — so a typo'd
 * provider name fails typecheck in the host instead of resolving to "unknown
 * provider" at runtime.
 *
 * @example
 * const providers = defineProviders({
 *   stone: stoneProvider(PT_BR_STONE_COPY),
 *   infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
 *   stripe: stripeProvider(PT_BR_STRIPE_COPY),
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
  for (const [name, adapter] of byName) assertPaymentProofPaired(name, adapter);

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
