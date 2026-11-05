import { describe, expect, it, vi } from 'vitest';

import { buyerCheckoutConfig, type CheckoutConfigDeps, type WalletApprovalPort } from '../config';
import type { ClientProviderConfig } from '../../core/client-view';
import type { PaymentsGateway } from '../../core/gateway';
import type { CredentialStore } from '../../core/ports';
import type { WalletType } from '../../core/types';

/**
 * FUT-4400: the platform offers a wallet only once Google (or Apple) approved
 * the production integration. While the host's approval port answers `false`,
 * every chain entry drops that wallet and Google Pay's parameters are nulled,
 * so the browser fails closed with no change of its own.
 */

const MERCHANT = { kind: 'TENANT', id: 'store-1' } as const;
const PARAMS = { gateway: 'pagbank', gatewayMerchantId: 'ACCO_1', environment: 'PRODUCTION' as const };

function entry(provider: string): ClientProviderConfig {
  return {
    provider,
    displayName: provider,
    tokenization: 'PUBLIC_KEY',
    publicKey: 'pk',
    customerSchema: [],
    methods: ['PIX', 'CARD'],
    wallets: ['GOOGLE_PAY', 'APPLE_PAY'],
    googlePay: PARAMS,
    checkoutScreen: null,
    confirmation: 'AUTOMATIC',
  };
}

/** Two wallet-declaring entries on STUB connections, so Apple Pay needs no identity port. */
function deps(walletApproval?: WalletApprovalPort): CheckoutConfigDeps {
  return {
    gateway: { clientConfigChain: async () => [entry('alpha'), entry('beta')] } as unknown as PaymentsGateway,
    credentials: { getCredentials: async () => ({ environment: 'SANDBOX', fields: {}, stub: true }) } as unknown as CredentialStore,
    connections: { get: async () => null, save: async () => undefined },
    googlePayMerchant: { merchantId: 'BCR2DN_1' },
    ...(walletApproval ? { walletApproval } : {}),
  };
}

function approving(...approved: WalletType[]): WalletApprovalPort {
  return (wallet) => Promise.resolve(approved.includes(wallet));
}

describe('buyerCheckoutConfig — the platform wallet approval', () => {
  it('strips both wallets from every entry and nulls Google Pay while neither is approved', async () => {
    const config = await buyerCheckoutConfig(deps(approving()), MERCHANT);
    expect(config.chain.map((link) => link.wallets)).toEqual([[], []]);
    expect(config.chain.map((link) => link.googlePay)).toEqual([null, null]);
  });

  it('keeps Apple Pay and hides Google Pay when only Apple Pay is approved', async () => {
    const config = await buyerCheckoutConfig(deps(approving('APPLE_PAY')), MERCHANT);
    expect(config.chain.map((link) => link.wallets)).toEqual([['APPLE_PAY'], ['APPLE_PAY']]);
    expect(config.chain.map((link) => link.googlePay)).toEqual([null, null]);
  });

  it('keeps Google Pay with its merchant id and hides Apple Pay when only Google Pay is approved', async () => {
    const config = await buyerCheckoutConfig(deps(approving('GOOGLE_PAY')), MERCHANT);
    expect(config.chain.map((link) => link.wallets)).toEqual([['GOOGLE_PAY'], ['GOOGLE_PAY']]);
    expect(config.chain[0]?.googlePay).toEqual({ ...PARAMS, merchantInfo: { merchantId: 'BCR2DN_1' } });
  });

  it('offers both wallets as the adapters declare them once both are approved', async () => {
    const config = await buyerCheckoutConfig(deps(approving('GOOGLE_PAY', 'APPLE_PAY')), MERCHANT);
    expect(config.chain.map((link) => link.wallets)).toEqual([
      ['GOOGLE_PAY', 'APPLE_PAY'],
      ['GOOGLE_PAY', 'APPLE_PAY'],
    ]);
  });

  it('leaves the declarations alone when the host gives no port', async () => {
    const config = await buyerCheckoutConfig(deps(), MERCHANT);
    expect(config.chain[0]?.wallets).toEqual(['GOOGLE_PAY', 'APPLE_PAY']);
    expect(config.chain[0]?.googlePay).not.toBeNull();
  });

  it('fails closed when the approval read throws or rejects', async () => {
    const throwing = await buyerCheckoutConfig(
      deps(() => {
        throw new Error('db down');
      }),
      MERCHANT,
    );
    const rejecting = await buyerCheckoutConfig(deps(() => Promise.reject(new Error('db down'))), MERCHANT);
    for (const config of [throwing, rejecting]) {
      expect(config.chain.map((link) => link.wallets)).toEqual([[], []]);
      expect(config.chain[0]?.googlePay).toBeNull();
    }
  });

  it('asks the port once per wallet per read, however many entries declare it', async () => {
    const port = vi.fn(approving('GOOGLE_PAY'));
    await buyerCheckoutConfig(deps(port), MERCHANT);
    expect(port.mock.calls.map(([wallet]) => wallet).sort()).toEqual(['APPLE_PAY', 'GOOGLE_PAY']);
  });

  it('never asks the Apple Pay identity port for a wallet that is not approved', async () => {
    const merchantIdentity = vi.fn(async () => null);
    await buyerCheckoutConfig({ ...deps(approving()), applePay: { merchantIdentity } }, MERCHANT);
    expect(merchantIdentity).not.toHaveBeenCalled();
  });
});
