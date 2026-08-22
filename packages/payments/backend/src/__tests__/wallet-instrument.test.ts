import { describe, expect, it } from 'vitest';

import { chargeInputFor, hasInstrument } from '../core/card-instrument';
import { toClientProviderConfig } from '../core/client-view';
import { UnsupportedOperationError } from '../core/errors';
import type { ChargeInput } from '../core/types';
import { pagbankProvider } from '../providers/pagbank';
import { cardInput, setupGatewayWorld, STUB_CREDS, TENANT } from './fixtures';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';

/**
 * FUT-471/472 — how a WALLET instrument travels through the core.
 *
 * A wallet key is provider-bound exactly like a one-time card token: Google
 * mints it against the head's `gatewayMerchantId`, Apple against the head's
 * certificate. So the ownership rules of `core/card-instrument.ts` must treat
 * it as the chain head's, and the capability table must be able to refuse it
 * BEFORE anything goes out — a wallet charge on a provider that never declared
 * the wallet is a guaranteed rejection that would burn the walk.
 */

function walletInput(reference = 'order-w'): ChargeInput {
  return {
    ...cardInput(reference),
    card: { wallet: { type: 'GOOGLE_PAY', key: 'gp_tok' } },
  };
}

describe('wallet instruments are chain-head-bound', () => {
  it('passes the wallet through to the chain head', () => {
    const result = chargeInputFor(walletInput(), 'alpha', 'alpha', { tokenization: 'PUBLIC_KEY', wallets: ['GOOGLE_PAY'] });
    expect(hasInstrument(result)).toBe(true);
    expect(hasInstrument(result) && result.card?.wallet?.key).toBe('gp_tok');
  });

  it('refuses to hand the wallet key to a tail provider that needs an instrument', () => {
    // The tail could no more read a foreign wallet token than a foreign
    // encrypted blob — attempting it is a guaranteed validation error that
    // classifies DEFINITELY_NOT_CHARGED and burns the rest of the chain.
    const result = chargeInputFor(walletInput(), 'beta', 'alpha', { tokenization: 'PUBLIC_KEY', wallets: ['GOOGLE_PAY'] });
    expect(hasInstrument(result)).toBe(false);
  });

  it('drops the wallet for a REDIRECT tail, which takes the card on its own page', () => {
    const result = chargeInputFor(walletInput(), 'beta', 'alpha', { tokenization: 'REDIRECT', wallets: ['GOOGLE_PAY'] });
    expect(hasInstrument(result)).toBe(true);
    expect(hasInstrument(result) && result.card).toBeUndefined();
  });
});

describe('the capability table gates wallet charges', () => {
  it('refuses a pinned wallet charge on a provider that never declared the wallet', async () => {
    // The fixtures' fake adapter declares no `wallets`, so the typed refusal
    // must name the gap — never reach `createCharge`, never read as an outage.
    const world = setupGatewayWorld();
    await expect(
      world.gateway.charge(TENANT, walletInput(), { provider: 'stone' }),
    ).rejects.toThrow(UnsupportedOperationError);
  });
});

describe('the client view publishes the wallet capability (FUT-471)', () => {
  it('stamps wallets from the capability table and normalizes googlePay', () => {
    const published = toClientProviderConfig(pagbankProvider(PT_BR_PAGBANK_COPY), {
      environment: 'SANDBOX',
      fields: { token: 't', publicKey: 'pk', googlePayMerchantId: 'MID_1' },
    });
    expect(published.wallets).toContain('GOOGLE_PAY');
    expect(published.googlePay).toEqual({ gateway: 'pagbank', gatewayMerchantId: 'MID_1' });
  });

  it('publishes [] and null for an adapter that declares no wallet', () => {
    const world = setupGatewayWorld();
    const published = toClientProviderConfig(world.adapter, STUB_CREDS);
    expect(published.wallets).toEqual([]);
    expect(published.googlePay).toBeNull();
  });
});
