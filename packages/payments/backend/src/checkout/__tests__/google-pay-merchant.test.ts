import { describe, expect, it } from 'vitest';

import { buyerCheckoutConfig, type CheckoutConfigDeps } from '../config';
import { platformGooglePayMerchant } from '../google-pay-merchant';
import type { ClientProviderConfig } from '../../core/client-view';
import type { PaymentsGateway } from '../../core/gateway';
import type { CredentialStore } from '../../core/ports';

/**
 * Google requires its own merchant id on every PRODUCTION request. It is one
 * per deployment, so the host hands it over and the config stamps it onto each
 * entry that publishes Google Pay parameters.
 */

const MERCHANT = { kind: 'TENANT', id: 'store-1' } as const;

function entry(googlePay: ClientProviderConfig['googlePay']): ClientProviderConfig {
  return {
    provider: 'pagbank',
    displayName: 'PagBank',
    tokenization: 'PUBLIC_KEY',
    publicKey: 'pk',
    customerSchema: [],
    methods: ['PIX', 'CARD'],
    wallets: ['GOOGLE_PAY'],
    googlePay,
    checkoutScreen: null,
    confirmation: 'AUTOMATIC',
  };
}

function deps(chain: ClientProviderConfig[], googlePayMerchant?: CheckoutConfigDeps['googlePayMerchant']): CheckoutConfigDeps {
  return {
    gateway: { clientConfigChain: async () => chain } as unknown as PaymentsGateway,
    credentials: { getCredentials: async () => ({ environment: 'PRODUCTION', fields: {}, stub: false }) } as unknown as CredentialStore,
    connections: { get: async () => null, save: async () => undefined },
    ...(googlePayMerchant === undefined ? {} : { googlePayMerchant }),
  };
}

const PARAMS = { gateway: 'pagbank', gatewayMerchantId: 'ACCO_1', environment: 'PRODUCTION' as const };

describe("the platform's Google merchant id", () => {
  it('is stamped onto an entry that publishes Google Pay parameters', async () => {
    const config = await buyerCheckoutConfig(deps([entry(PARAMS)], { merchantId: 'BCR2DN_1', merchantName: 'Paladira' }), MERCHANT);
    expect(config.chain[0]?.googlePay).toEqual({ ...PARAMS, merchantInfo: { merchantId: 'BCR2DN_1', merchantName: 'Paladira' } });
  });

  it('leaves the parameters alone when the host configured none', async () => {
    const config = await buyerCheckoutConfig(deps([entry(PARAMS)], null), MERCHANT);
    expect(config.chain[0]?.googlePay).toEqual(PARAMS);
  });

  it('never invents parameters for an entry that cannot run Google Pay', async () => {
    const config = await buyerCheckoutConfig(deps([entry(null)], { merchantId: 'BCR2DN_1' }), MERCHANT);
    expect(config.chain[0]?.googlePay).toBeNull();
  });
});

describe('platformGooglePayMerchant', () => {
  it('reads the id and the name from the environment', () => {
    expect(platformGooglePayMerchant({ GOOGLE_PAY_MERCHANT_ID: ' BCR2DN_1 ', GOOGLE_PAY_MERCHANT_NAME: 'Paladira' })).toEqual({ merchantId: 'BCR2DN_1', merchantName: 'Paladira' });
  });

  it('answers null while the id is not set', () => {
    expect(platformGooglePayMerchant({ GOOGLE_PAY_MERCHANT_NAME: 'Paladira' })).toBeNull();
  });
});
