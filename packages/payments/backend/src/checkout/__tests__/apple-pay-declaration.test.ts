import { describe, expect, it } from 'vitest';

import type { PaymentProviderAdapter } from '../../core/provider';

import { call, MERCHANT, setupCheckoutWorld, testAdapter } from './harness';

/**
 * Contract R5 through the MOUNT (FUT-3686): `createPaymentFlowsBE({ applePay })`
 * hands its port to the `/config` read, which drops `APPLE_PAY` from a live
 * connection with no merchant identity.
 */

/** A card acquirer declaring both wallets, as the PagBank adapter does. */
function walletAdapter(): PaymentProviderAdapter {
  const base = testAdapter('alpha');
  return { ...base, capabilities: { ...base.capabilities, wallets: ['GOOGLE_PAY', 'APPLE_PAY'] } };
}

const IDENTITY = {
  merchantIdentifier: 'merchant.com.example',
  displayName: 'Loja Exemplo',
  certificate: 'cert',
  privateKey: 'key',
};

/** A live (non-stub) connection, so the stub short-circuit cannot answer for the port. */
function liveWorld(applePay?: { merchantIdentity: () => Promise<typeof IDENTITY | null> }) {
  const world = setupCheckoutWorld({
    chain: [{ name: 'alpha', adapter: walletAdapter() }],
    ...(applePay ? { config: { applePay } } : {}),
  });
  world.credentials.set(MERCHANT, 'alpha', { environment: 'PRODUCTION', fields: {}, stub: false });
  return world;
}

async function walletsAtConfig(routes: ReturnType<typeof liveWorld>['routes']): Promise<unknown> {
  const { body } = await call(routes, 'GET', '/config');
  const chain = (body.data as { chain: { wallets: unknown }[] }).chain;
  return chain[0]?.wallets;
}

describe('createPaymentFlowsBE /config — the Apple Pay declaration', () => {
  it('declares no APPLE_PAY without the port', async () => {
    expect(await walletsAtConfig(liveWorld().routes)).toEqual(['GOOGLE_PAY']);
  });

  it('declares no APPLE_PAY when the port has no merchant identity', async () => {
    expect(await walletsAtConfig(liveWorld({ merchantIdentity: async () => null }).routes)).toEqual(['GOOGLE_PAY']);
  });

  it('declares APPLE_PAY when the port reports a merchant identity', async () => {
    expect(await walletsAtConfig(liveWorld({ merchantIdentity: async () => IDENTITY }).routes)).toEqual([
      'GOOGLE_PAY',
      'APPLE_PAY',
    ]);
  });
});
