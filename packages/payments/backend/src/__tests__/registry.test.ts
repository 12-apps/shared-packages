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
});
