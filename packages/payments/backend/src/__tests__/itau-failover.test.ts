import { describe, expect, it, vi } from 'vitest';

import { createSettingsService, credentialStoreFrom } from '../config/service';
import { AmbiguousChargeError, CredentialsError, ProviderRequestError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { isOutageSignal } from '../core/provider-health';
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
import { ItauTokenError } from '../providers/itau-http';
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

describe('an ambiguous cob followed by a token 404', () => {
  it('stops the walk rather than fail over — a 404 from the token endpoint says nothing about the cob', async () => {
    // First mint answers, the cob PUT fails ambiguously (it may exist), then
    // the probe's own mint 404s. Only the cob read may prove "not raised".
    const mintAnswers = [JSON.stringify({ access_token: 't', expires_in: 300 })];
    vi.stubGlobal('fetch', async (url: string) => {
      if (!String(url).includes('/api/jwt')) return new Response('{}', { status: 502 });
      const token = mintAnswers.shift();
      return token ? new Response(token, { status: 200 }) : new Response('{}', { status: 404 });
    });
    try {
      const credentials = createMemoryCredentialStore();
      const probeAttempts = createMemoryAttemptLedger();
      const probeGateway = createPaymentsGateway({
        providers: defineProviders({
          itau: itauProvider(PT_BR_ITAU_COPY),
          infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
        } as const),
        credentials,
        charges: createMemoryChargeStore(),
        webhooks: createMemoryWebhookInbox(),
        attempts: probeAttempts,
      });
      credentials.set(TENANT, 'itau', { environment: 'SANDBOX', fields: { clientId: 'c', clientSecret: 's', pixKey: 'loja@example.com' } });
      credentials.set(TENANT, 'infinitepay', STUB_CREDS);
      const outcome = await probeGateway.charge(TENANT, pixInput('order-probe-404')).catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(AmbiguousChargeError);
      expect((outcome as AmbiguousChargeError).probeResult).toBe('PROBE_FAILED');
      expect(ledgerFor(probeAttempts, 'order-probe-404').map(([provider]) => provider)).not.toContain('infinitepay');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('a token-service outage', () => {
  it('fails a charge over to the next provider — the mint is its own endpoint, nothing was charged', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    try {
      const credentials = createMemoryCredentialStore();
      const outageGateway = createPaymentsGateway({
        providers: defineProviders({
          itau: itauProvider(PT_BR_ITAU_COPY),
          infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
        } as const),
        credentials,
        charges: createMemoryChargeStore(),
        webhooks: createMemoryWebhookInbox(),
        attempts: createMemoryAttemptLedger(),
      });
      // A LIVE sandbox connection (no stub flag): the token mint really runs, and answers 503.
      credentials.set(TENANT, 'itau', { environment: 'SANDBOX', fields: { clientId: 'c', clientSecret: 's', pixKey: 'loja@example.com' } });
      credentials.set(TENANT, 'infinitepay', STUB_CREDS);
      const stored = await outageGateway.charge(TENANT, pixInput('order-outage-1'));
      expect(stored.snapshot.provider).toBe('infinitepay');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('counts toward the circuit breaker when its cause was a 5xx', () => {
    const outage = new ItauTokenError('mint failed', {
      mtls: false,
      httpStatus: 503,
      cause: new ProviderRequestError('itau', 'oauth/token 503', { httpStatus: 503 }),
    });
    expect(isOutageSignal(outage)).toBe(true);
    expect(isOutageSignal(new CredentialsError('itau', 'not connected'))).toBe(false);
  });
});

