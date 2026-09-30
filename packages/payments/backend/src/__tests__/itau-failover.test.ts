import { describe, expect, it } from 'vitest';

import { createSettingsService, credentialStoreFrom } from '../config/service';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import type { ResolvedCredentials } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { infinitePayProvider } from '../providers/infinitepay';
import { itauProvider } from '../providers/itau';
import { STUB_CHARGE_FAULT_FIELD } from '../providers/stub-fault';
import { PT_BR_INFINITEPAY_COPY, PT_BR_ITAU_COPY } from '../providers/pt-BR';
import { pixInput, STUB_CREDS, TENANT } from './fixtures';

/**
 * Itau at the HEAD of a chain must never be the reason a buyer cannot pay:
 * whatever is wrong with its connection, the walk moves on to the next
 * provider. Real gateway, real walk; only the far end is stubbed.
 */
async function itauThenInfinitePay(itauCredentials: Omit<ResolvedCredentials, 'stub'>) {
  const configStore = createMemoryProviderConfigStore();
  const providers = defineProviders({
    itau: itauProvider(PT_BR_ITAU_COPY),
    infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  } as const);
  const settings = createSettingsService(providers, configStore, { allowStubMode: true });
  const attempts = createMemoryAttemptLedger();
  const gateway = createPaymentsGateway({
    providers,
    credentials: credentialStoreFrom(configStore, { allowStubMode: true }),
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });
  await settings.saveCredentials(TENANT, 'itau', itauCredentials);
  await settings.saveCredentials(TENANT, 'infinitepay', { environment: 'SANDBOX', fields: {} });
  await settings.applyChargeVerification(TENANT, 'infinitepay', true);
  // Itau needs no activation charge: enabling it must just work (it used to
  // be locked behind a CARD proof it cannot produce).
  await settings.setEnabled(TENANT, 'itau', true);
  await settings.setPriorities(TENANT, ['itau', 'infinitepay']);
  return { gateway, attempts };
}

function ledgerFor(attempts: ReturnType<typeof createMemoryAttemptLedger>, reference: string) {
  return attempts
    .all()
    .filter((attempt) => attempt.reference === reference)
    .map((attempt) => [attempt.provider, attempt.outcome]);
}

describe('itau at the head of the chain', () => {
  it('can be enabled with no activation charge', async () => {
    const { gateway: enableGateway } = await itauThenInfinitePay({ environment: 'SANDBOX', fields: {} });
    const stored = await enableGateway.charge(TENANT, pixInput('order-enable-1'));
    expect(stored.snapshot.provider).toBe('itau');
  });

  it('fails over when its PRODUCTION connection has no certificate', async () => {
    const { gateway: noCertGateway, attempts: noCertAttempts } = await itauThenInfinitePay({
      environment: 'PRODUCTION',
      fields: { clientId: 'c', clientSecret: 's', pixKey: 'loja@example.com' },
    });
    const stored = await noCertGateway.charge(TENANT, pixInput('order-nocert-1'));
    expect(stored.snapshot.provider).toBe('infinitepay');
    expect(ledgerFor(noCertAttempts, 'order-nocert-1')[0]).toEqual(['itau', 'FAILED_OVER']);
  });

  it('fails over when its connection is missing fields', async () => {
    const { gateway: missingGateway } = await itauThenInfinitePay({ environment: 'PRODUCTION', fields: { clientId: 'c' } });
    const stored = await missingGateway.charge(TENANT, pixInput('order-missing-1'));
    expect(stored.snapshot.provider).toBe('infinitepay');
  });

  it('fails over after an ambiguous failure, because its probe finds nothing to adopt', async () => {
    // Scripted through a raw credential store, as `redirect-failover.test.ts`
    // does: the settings service rightly refuses a field the schema lacks.
    const credentials = createMemoryCredentialStore();
    const scriptedAttempts = createMemoryAttemptLedger();
    const scripted = createPaymentsGateway({
      providers: defineProviders({
        itau: itauProvider(PT_BR_ITAU_COPY),
        infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
      } as const),
      credentials,
      charges: createMemoryChargeStore(),
      webhooks: createMemoryWebhookInbox(),
      attempts: scriptedAttempts,
    });
    credentials.set(TENANT, 'itau', { ...STUB_CREDS, fields: { [STUB_CHARGE_FAULT_FIELD]: 'ambiguous' } });
    credentials.set(TENANT, 'infinitepay', STUB_CREDS);

    const stored = await scripted.charge(TENANT, pixInput('order-ambiguous-1'));
    expect(stored.snapshot.provider).toBe('infinitepay');
    expect(stored.snapshot.amount.amountCents).toBe(12_50);
    expect(ledgerFor(scriptedAttempts, 'order-ambiguous-1')[0]?.[0]).toBe('itau');
  });
});
