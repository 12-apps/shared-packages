import { describe, expect, it } from 'vitest';

import { platformApplePayIdentities, platformApplePayIdentity } from '../platform-identity';

/** FUT-3757 — the platform's Apple Pay Merchant ID, from the deployment's environment. Fake values. */
const CONFIGURED = {
  APPLE_PAY_MERCHANT_ID: 'merchant.com.example',
  APPLE_PAY_MERCHANT_CERT: 'fake-certificate',
  APPLE_PAY_MERCHANT_KEY: 'fake-signing-material',
  APPLE_PAY_DOMAINS: ' example.com , www.example.com ,',
};

const LONG_NAME = 'Loja Exemplo com um nome bem comprido que passa do limite da Apple';

function identities(vars: Record<string, string | undefined>) {
  return platformApplePayIdentities({ env: vars, storeName: async (id) => (id === 'store-1' ? LONG_NAME : null) });
}

describe('platformApplePayIdentity', () => {
  it('reads the Merchant ID, certificate, key and verified domains', () => {
    expect(platformApplePayIdentity(CONFIGURED)).toEqual({
      merchantIdentifier: 'merchant.com.example',
      certificate: 'fake-certificate',
      privateKey: 'fake-signing-material',
      domains: ['example.com', 'www.example.com'],
    });
  });

  it('answers null while any of the three credentials is missing', () => {
    expect(platformApplePayIdentity({})).toBeNull();
    expect(platformApplePayIdentity({ ...CONFIGURED, APPLE_PAY_MERCHANT_KEY: ' ' })).toBeNull();
  });

  it('omits the domain list when none is configured', () => {
    expect(platformApplePayIdentity({ ...CONFIGURED, APPLE_PAY_DOMAINS: undefined })).not.toHaveProperty('domains');
  });
});

describe('platformApplePayIdentities', () => {
  it("names the store on the sheet, within Apple's 64 characters", async () => {
    const identity = await identities(CONFIGURED).merchantIdentity({ kind: 'TENANT', id: 'store-1' });
    expect(identity?.merchantIdentifier).toBe('merchant.com.example');
    expect(identity?.displayName).toBe([...LONG_NAME].slice(0, 64).join(''));
  });

  it('answers null with nothing configured, for the platform itself, and for an unknown store', async () => {
    expect(await identities({}).merchantIdentity({ kind: 'TENANT', id: 'store-1' })).toBeNull();
    expect(await identities(CONFIGURED).merchantIdentity({ kind: 'PLATFORM', id: 'p' })).toBeNull();
    expect(await identities(CONFIGURED).merchantIdentity({ kind: 'TENANT', id: 'unknown' })).toBeNull();
  });

  it('reads the environment at call time, so a rotated certificate needs no restart', async () => {
    const vars: Record<string, string | undefined> = {};
    const port = identities(vars);
    expect(await port.merchantIdentity({ kind: 'TENANT', id: 'store-1' })).toBeNull();
    Object.assign(vars, CONFIGURED);
    expect(await port.merchantIdentity({ kind: 'TENANT', id: 'store-1' })).not.toBeNull();
  });
});
