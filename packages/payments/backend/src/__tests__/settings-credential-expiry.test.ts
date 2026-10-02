import { X509Certificate } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createSettingsService } from '../config/service';
import { defineProviders } from '../core/registry';
import { createMemoryProviderConfigStore } from '../memory';
import { itauProvider } from '../providers/itau';
import { PT_BR_ITAU_COPY, PT_BR_STONE_COPY } from '../providers/pt-BR';
import { stoneProvider } from '../providers/stone';
import { selfSignedIdentity } from '../providers/__tests__/pki';
import { TENANT } from './fixtures';

/**
 * The masked settings view carries when the saved PRODUCTION credentials lapse
 * on their own (`credentialExpiresAt`), from the adapter's `credentialExpiry` —
 * what the screen warns from, inside Itaú's 30-day renewal window. Derived on
 * read: the stored row, and the OAuth `expiresAt` the renewal sweep reads, are
 * left alone.
 */

function world() {
  const store = createMemoryProviderConfigStore();
  const providers = defineProviders({
    itau: itauProvider(PT_BR_ITAU_COPY),
    stone: stoneProvider(PT_BR_STONE_COPY),
  } as const);
  return { store, settings: createSettingsService(providers, store) };
}

describe('credentialExpiresAt on the masked settings view', () => {
  it('is the saved production certificate’s validTo, and leaves expiresAt null', async () => {
    const { store, settings } = world();
    const identity = selfSignedIdentity('loja');
    await settings.saveCredentials(TENANT, 'itau', {
      environment: 'PRODUCTION',
      fields: { clientId: 'c', clientSecret: 's', pixKey: 'k', certificate: identity.cert, privateKey: identity.key },
    });

    const view = (await settings.getSettings(TENANT)).configs.find((config) => config.provider === 'itau');

    expect(view?.credentialExpiresAt).toBe(new Date(new X509Certificate(identity.cert).validTo).toISOString());
    expect(view?.expiresAt).toBeNull();
    expect((await store.get(TENANT, 'itau'))?.expiresAt).toBeNull();
  });

  it('is null while only sandbox credentials are saved — the sandbox has no certificate', async () => {
    const { settings } = world();
    await settings.saveCredentials(TENANT, 'itau', {
      environment: 'SANDBOX',
      fields: { clientId: 'c', clientSecret: 's', pixKey: 'k' },
    });

    const view = (await settings.getSettings(TENANT)).configs.find((config) => config.provider === 'itau');

    expect(view?.credentialExpiresAt).toBeNull();
  });

  it('is null for a provider whose credentials never lapse on their own', async () => {
    const { settings } = world();
    await settings.saveCredentials(TENANT, 'stone', { environment: 'SANDBOX', fields: { secretKey: 'sk_1' } });

    const view = (await settings.getSettings(TENANT)).configs.find((config) => config.provider === 'stone');

    expect(view?.credentialExpiresAt).toBeNull();
  });
});
