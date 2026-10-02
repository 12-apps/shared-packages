import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSettingsService } from '../config/service';
import { defineProviders } from '../core/registry';
import type { MerchantRef } from '../core/types';
import { createMemoryProviderConfigStore } from '../memory';
import { itauProvider } from '../providers/itau';
import { PT_BR_ITAU_COPY } from '../providers/pt-BR';
import { stubItauFetch } from '../providers/__tests__/itau-fetch';
import { TENANT } from './fixtures';

/**
 * `createSettingsService({ webhookUrl })` hands the credential probe the
 * merchant's webhook URL, so an adapter that registers its webhook through an
 * API does it on "Testar conexão" — and the URL is resolved per probe, never
 * written onto the stored connection.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const FIELDS = { clientId: 'client-1', clientSecret: 'secret-1', pixKey: 'loja@example.com' };

function world(webhookUrl?: (merchant: MerchantRef, provider: string) => Promise<string | null>) {
  const memory = createMemoryProviderConfigStore();
  const registry = defineProviders({ itau: itauProvider(PT_BR_ITAU_COPY) } as const);
  return { store: memory, settings: createSettingsService(registry, memory, webhookUrl ? { webhookUrl } : {}) };
}

/** A connection whose stored row still carries an old `notificationUrl` (pre-FUT-694), probed. */
async function probeWithStaleRow(resolver?: (merchant: MerchantRef, provider: string) => Promise<string | null>) {
  const stale = world(resolver);
  const staleCalls = stubItauFetch(() => undefined);
  await stale.settings.saveCredentials(TENANT, 'itau', { environment: 'SANDBOX', fields: FIELDS });
  const row = await stale.store.get(TENANT, 'itau');
  if (!row) throw new Error('saved row missing');
  const environments = { ...row.environments, SANDBOX: { ...FIELDS, notificationUrl: 'https://old-domain.example/hook' } };
  await stale.store.save(TENANT, { ...row, environments });
  const verified = await stale.settings.verify(TENANT, 'itau');
  expect(verified.probe.checks?.[0]?.status).toBe('UNCHECKED');
  return staleCalls;
}

describe('the settings probe and the merchant webhook URL', () => {
  it('passes the resolved URL to the probe, which registers it, and never stores it', async () => {
    const resolve = vi.fn(async (merchant: MerchantRef, provider: string) => `https://loja.example/api/webhooks/payments/${merchant.id}/${provider}`);
    const world1 = world(resolve);
    const calls = stubItauFetch((call) => (call.method === 'PUT' ? { body: {} } : undefined));
    await world1.settings.saveCredentials(TENANT, 'itau', { environment: 'SANDBOX', fields: FIELDS });

    const verified = await world1.settings.verify(TENANT, 'itau');

    expect(resolve).toHaveBeenCalledWith(TENANT, 'itau');
    const put = calls.find((call) => call.method === 'PUT' && call.url.includes('/webhook/'));
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ webhookUrl: 'https://loja.example/api/webhooks/payments/tenant-1/itau' });
    expect(verified.probe.ok).toBe(true);
    expect(verified.probe.checks).toEqual([{ key: 'pixKey', status: 'PASS', message: PT_BR_ITAU_COPY.webhook.registered }]);
    const stored = await world1.store.get(TENANT, 'itau');
    expect(stored?.environments.SANDBOX).toEqual(FIELDS);
    expect(JSON.stringify(stored)).not.toContain('notificationUrl');
  });

  it('runs the probe on the stored fields alone when the host gives no resolver', async () => {
    const { settings } = world();
    const calls = stubItauFetch(() => undefined);
    await settings.saveCredentials(TENANT, 'itau', { environment: 'SANDBOX', fields: FIELDS });

    const verified = await settings.verify(TENANT, 'itau');

    expect(calls.some((call) => call.url.includes('/webhook/'))).toBe(false);
    expect(verified.probe.checks).toEqual([{ key: 'pixKey', status: 'UNCHECKED', message: PT_BR_ITAU_COPY.webhook.notRegistered }]);
  });

  it('never registers a URL found on the stored row when the host gives no resolver', async () => {
    const calls = await probeWithStaleRow();

    expect(calls.some((call) => call.url.includes('/webhook/'))).toBe(false);
  });

  it('never registers a URL found on the stored row when the resolver answers null', async () => {
    const calls = await probeWithStaleRow(async () => null);

    expect(calls.some((call) => call.url.includes('/webhook/'))).toBe(false);
  });

  it('adds nothing when the resolver cannot address the merchant', async () => {
    const { settings } = world(async () => null);
    const calls = stubItauFetch(() => undefined);
    await settings.saveCredentials(TENANT, 'itau', { environment: 'SANDBOX', fields: FIELDS });

    const verified = await settings.verify(TENANT, 'itau');

    expect(calls.some((call) => call.url.includes('/webhook/'))).toBe(false);
    expect(verified.probe.checks?.[0]?.status).toBe('UNCHECKED');
  });
});
