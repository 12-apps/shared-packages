import { describe, expect, it } from 'vitest';

import { AdapterContractError, UnknownProviderError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import { infinitePayProvider } from '../providers/infinitepay';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { activationAdapter } from './activation-fixtures';

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

  /**
   * FUT-726 — the two halves of the payment-proof declaration must arrive
   * together, and the registry is where a host finds that out.
   *
   * An adapter that says its PROCESSED deliveries prove payment but cannot say
   * WHICH charge they prove is not merely incomplete: reconciliation asks it
   * for a correlation key, gets nothing, and reports "unproven" — the same
   * answer a genuinely unpaid activation gives. Every stranded activation of
   * that provider's merchants would stop healing with no error, no log and no
   * failing test. Refusing it at registration turns months of invisible
   * non-healing into a boot that fails while someone is looking.
   */
  it('refuses an adapter that declares verifyConfirmsPayment with no way to correlate', () => {
    // The cast IS the scenario: the union makes this shape unwritable in
    // TypeScript, so what reaches a running host is a JS caller or a cast.
    const halfDeclared = {
      ...activationAdapter('halfpay'),
      verifyConfirmsPayment: true,
    } as unknown as PaymentProviderAdapter;

    expect(() => defineProviders({ halfpay: halfDeclared })).toThrow(AdapterContractError);
    expect(() => defineProviders({ halfpay: halfDeclared })).toThrow(/referenceOfDelivery/);
  });

  it('accepts the pair declared together', () => {
    const paying = activationAdapter('paypay', {}, {
      verifyConfirmsPayment: true,
      referenceOfDelivery: () => 'ref-1',
    });

    expect(defineProviders({ paypay: paying }).names).toEqual(['paypay']);
  });

  it('is a compile error to declare the flag without the reader', () => {
    // Not a runtime assertion — the assertion is that `tsc` rejects the line
    // below. Delete the pairing from the contract and this file stops
    // typechecking, because the suppression has nothing left to suppress.
    const halfDeclared = {
      ...activationAdapter('halfpay'),
      verifyConfirmsPayment: true,
      // @ts-expect-error — verifyConfirmsPayment: true demands referenceOfDelivery (FUT-726).
    } satisfies PaymentProviderAdapter;

    expect(halfDeclared.name).toBe('halfpay');
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
