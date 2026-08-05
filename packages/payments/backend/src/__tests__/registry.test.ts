import { describe, expect, it } from 'vitest';

import { UnknownProviderError } from '../core/errors';
import { defineProviders } from '../core/registry';
import { infinitePayProvider } from '../providers/infinitepay';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';

describe('defineProviders', () => {
  const providers = defineProviders({
    stone: stoneProvider(),
    infinitepay: infinitePayProvider(),
    stripe: stripeProvider(),
  } as const);

  it('exposes the registered names', () => {
    expect(providers.names).toEqual(['stone', 'infinitepay', 'stripe']);
  });

  it('resolves a registered adapter', () => {
    expect(providers.get('stone').displayName).toBe('Stone');
    expect(providers.has('stripe')).toBe(true);
  });

  it('throws UnknownProviderError for names outside the registry', () => {
    expect(() => providers.get('pagseguro')).toThrow(UnknownProviderError);
    expect(providers.has('pagseguro')).toBe(false);
  });

  // URL identity is the ADAPTER's declaration (FUT-557): the registry only
  // resolves it, in both directions, so no host ever keeps a slug map. Built
  // fresh per test — the isolation lint reads calls on a suite-level registry
  // as shared mutable state.
  function slugRegistry() {
    return defineProviders({
      stone: stoneProvider(),
      infinitepay: infinitePayProvider(),
      stripe: stripeProvider(),
    } as const);
  }

  it('spells a url slug the way its adapter declares it, defaulting to the name', () => {
    const registry = slugRegistry();
    expect(registry.urlSlugOf('infinitepay')).toBe('infinite-pay');
    expect(registry.urlSlugOf('stone')).toBe('stone');
    expect(registry.urlSlugOf('stripe')).toBe('stripe');
  });

  it('round-trips every registered adapter through its url slug', () => {
    const registry = slugRegistry();
    for (const name of registry.names) {
      expect(registry.providerForUrlSlug(registry.urlSlugOf(name))).toBe(name);
    }
  });

  it('keeps the raw name as a working url alias, so old links do not 404', () => {
    expect(slugRegistry().providerForUrlSlug('infinitepay')).toBe('infinitepay');
  });

  it('passes unknown names and url segments through unchanged', () => {
    // The settings screen already renders a fallback for a provider the
    // backend does not offer; answering the segment back keeps that decision
    // where it always was instead of moving it here as a null.
    const registry = slugRegistry();
    expect(registry.urlSlugOf('acquirer-x')).toBe('acquirer-x');
    expect(registry.providerForUrlSlug('acquirer-x')).toBe('acquirer-x');
  });
});
