import type { PaymentProviderAdapter } from '../core/provider';
import { infinitePayProvider } from './infinitepay';
import { pagbankProvider } from './pagbank';
import { stoneProvider } from './stone';
import { stripeProvider } from './stripe';

/**
 * Every provider adapter this package SHIPS, keyed by its registry name — the
 * canonical list.
 *
 * A contract sweep (the FUT-595 buyer-requirements invariants above all) must
 * enumerate THIS rather than a list retyped inside a test file. A hand-kept
 * copy silently stops covering the next adapter added, so the sweep reports
 * green for precisely the adapter it was written to catch — the one nobody has
 * read the invariant for yet.
 *
 * Deliberately FACTORIES, not instances: adapters are built per call
 * everywhere else in this package, so nothing here becomes shared state.
 *
 * This is what the package ships, NOT what a deployment routes to. A host
 * still declares its own chain with `defineProviders` (`core/registry`) and may
 * register a subset — the invariants, being about the adapter contract, hold
 * for the whole set.
 *
 * `__tests__/provider-catalog.test.ts` pins this against the package's own
 * `exports` map, so an adapter published there but forgotten here fails loudly
 * instead of quietly escaping every sweep.
 */
export const providerCatalog = {
  pagbank: pagbankProvider,
  stone: stoneProvider,
  infinitepay: infinitePayProvider,
  stripe: stripeProvider,
} as const satisfies Record<string, () => PaymentProviderAdapter>;

/** Fresh instances of every shipped adapter — a contract sweep's input. */
export function allProviderAdapters(): PaymentProviderAdapter[] {
  return Object.values(providerCatalog).map((create) => create());
}
