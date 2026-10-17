import { describe, expect, it, vi } from 'vitest';

import { buyerCheckoutConfig, type CheckoutConfigDeps } from '../../checkout/config';
import type { ClientProviderConfig } from '../../core/client-view';
import type { PaymentsGateway } from '../../core/gateway';
import type { CredentialStore } from '../../core/ports';
import type { ResolvedCredentials } from '../../core/types';
import type { ApplePayIdentityPort, ApplePayMerchantIdentity } from '../types';

/**
 * Contract R5 (FUT-3686): a store declares Apple Pay only when a merchant
 * identity can validate its sessions. Before this, every PagBank store
 * declared it straight off the capability table.
 */

const MERCHANT = { kind: 'TENANT', id: 'store-1' } as const;

const IDENTITY: ApplePayMerchantIdentity = {
  merchantIdentifier: 'merchant.com.example',
  displayName: 'Loja Exemplo',
  certificate: 'cert',
  privateKey: 'key',
};

/** A chain entry exactly as the PagBank adapter declares itself: card, both wallets. */
function entry(provider: string, wallets: ClientProviderConfig['wallets'] = ['GOOGLE_PAY', 'APPLE_PAY']): ClientProviderConfig {
  return {
    provider,
    displayName: provider,
    tokenization: 'PUBLIC_KEY',
    publicKey: 'pk',
    customerSchema: [],
    methods: ['PIX', 'CARD'],
    wallets,
    googlePay: { gateway: 'gw', gatewayMerchantId: 'gm' },
    checkoutScreen: null,
    confirmation: 'AUTOMATIC',
  } as ClientProviderConfig;
}

function deps(options: {
  chain?: ClientProviderConfig[];
  stub?: boolean;
  applePay?: ApplePayIdentityPort;
}): CheckoutConfigDeps {
  const credentials: ResolvedCredentials = { environment: 'PRODUCTION', fields: {}, stub: options.stub ?? false };
  return {
    gateway: { clientConfigChain: async () => options.chain ?? [entry('alpha')] } as unknown as PaymentsGateway,
    credentials: { getCredentials: async () => credentials } as unknown as CredentialStore,
    connections: { get: async () => null, save: async () => undefined },
    ...(options.applePay ? { applePay: options.applePay } : {}),
  };
}

const port = (identity: ApplePayMerchantIdentity | null): ApplePayIdentityPort => ({
  merchantIdentity: vi.fn(async () => identity),
});

describe('the Apple Pay declaration gate', () => {
  it('drops APPLE_PAY from the buyer config when no identity port is wired', async () => {
    const config = await buyerCheckoutConfig(deps({}), MERCHANT);
    expect(config.chain[0]?.wallets).toEqual(['GOOGLE_PAY']);
  });

  it('drops APPLE_PAY when the port reports no merchant identity', async () => {
    const config = await buyerCheckoutConfig(deps({ applePay: port(null) }), MERCHANT);
    expect(config.chain[0]?.wallets).toEqual(['GOOGLE_PAY']);
  });

  it('keeps APPLE_PAY when the port reports a merchant identity, asking it once per read', async () => {
    const applePay = port(IDENTITY);
    const config = await buyerCheckoutConfig(deps({ applePay, chain: [entry('alpha'), entry('beta')] }), MERCHANT);
    expect(config.chain.map((link) => link.wallets)).toEqual([
      ['GOOGLE_PAY', 'APPLE_PAY'],
      ['GOOGLE_PAY', 'APPLE_PAY'],
    ]);
    expect(applePay.merchantIdentity).toHaveBeenCalledTimes(1);
    expect(applePay.merchantIdentity).toHaveBeenCalledWith(MERCHANT);
  });

  it('keeps APPLE_PAY on a stub connection with no identity, so e2e can render the button', async () => {
    const config = await buyerCheckoutConfig(deps({ stub: true }), MERCHANT);
    expect(config.chain[0]?.wallets).toEqual(['GOOGLE_PAY', 'APPLE_PAY']);
  });

  it('fails closed when the port throws', async () => {
    const applePay: ApplePayIdentityPort = {
      merchantIdentity: () => {
        throw new Error('vault down');
      },
    };
    const config = await buyerCheckoutConfig(deps({ applePay }), MERCHANT);
    expect(config.chain[0]?.wallets).toEqual(['GOOGLE_PAY']);
  });

  it('never ADDS Apple Pay to a provider that did not declare it, and leaves Google Pay alone', async () => {
    const applePay = port(IDENTITY);
    const config = await buyerCheckoutConfig(deps({ applePay, chain: [entry('alpha', ['GOOGLE_PAY'])] }), MERCHANT);
    expect(config.chain[0]?.wallets).toEqual(['GOOGLE_PAY']);
    expect(applePay.merchantIdentity).not.toHaveBeenCalled();
  });
});
