import { describe, expect, it, vi } from 'vitest';

import { createPaymentsGateway } from '../core/gateway';
import type { CredentialStore } from '../core/ports';
import type { PaymentProviderAdapter } from '../core/provider';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import type { WebhookPipelineObserver } from '../core/webhook-pipeline';

/**
 * The pre-inbox refusal trace (FUT-761, ported from the future-pay host).
 * Verification runs BEFORE the durable inbox, so a refused delivery is
 * recorded nowhere — a silence indistinguishable from "the provider never
 * called us", which hid FUT-463 through three rounds of fixes. The observer
 * makes "did they call?" and "did we refuse them?" separately answerable
 * without changing what the pipeline does.
 */

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'acme' };

const CREDS: ResolvedCredentials = {
  environment: 'PRODUCTION',
  fields: { handle: 'acme' },
  stub: false,
};

function adapter(verify: () => Promise<boolean>): PaymentProviderAdapter {
  return {
    name: 'infinitepay',
    displayName: 'InfinitePay',
    authMode: 'credentials',
    capabilities: {
      methods: ['PIX'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'REDIRECT',
    },
    credentialSchema: [],
    verifyCredentials: async () => ({ ok: true }),
    createCharge: async () => {
      throw new Error('not used');
    },
    getCharge: async () => {
      throw new Error('not used');
    },
    webhook: {
      verify,
      parse: async () => [
        { provider: 'infinitepay', eventId: 'evt-1', type: 'CHARGE_UPDATED' },
      ],
    },
    clientConfig: () => ({ provider: 'infinitepay', tokenization: 'REDIRECT' }),
  } as unknown as PaymentProviderAdapter;
}

const CONNECTED: CredentialStore = {
  providerChain: async () => ['infinitepay'],
  defaultProvider: async () => 'infinitepay',
  getCredentials: async () => CREDS,
  getConnectedCredentials: async () => CREDS,
};

function gatewayWith(
  store: CredentialStore,
  verify: () => Promise<boolean>,
  webhookObserver: WebhookPipelineObserver,
) {
  return createPaymentsGateway({
    providers: { get: () => adapter(verify) } as never,
    credentials: store,
    charges: {
      findByProviderChargeId: async () => null,
      findByIdempotencyKey: async () => null,
      create: async () => {
        throw new Error('not used');
      },
      upsertByProviderChargeId: async () => null,
    },
    webhooks: {
      record: async () => ({ id: 'row', duplicate: false, settled: false }),
      markProcessed: async () => undefined,
      markFailed: async () => undefined,
      listRetryable: async () => [],
    },
    webhookObserver,
  } as never);
}

const DELIVERY = { provider: 'infinitepay', rawBody: '{}', headers: {} };

describe('WebhookPipelineObserver', () => {
  it('reports a signature refusal — the delivery no row will ever record', async () => {
    const refused = vi.fn();
    const accepted = vi.fn();
    const gateway = gatewayWith(CONNECTED, async () => false, { refused, accepted });

    await expect(gateway.handleWebhook(MERCHANT, DELIVERY)).rejects.toThrow();

    expect(refused).toHaveBeenCalledOnce();
    const [provider, reason] = refused.mock.calls[0] as [string, string];
    expect(provider).toBe('infinitepay');
    expect(reason).toContain('verification failed');
    expect(accepted).not.toHaveBeenCalled();
  });

  it('reports a credential-lookup refusal too — the exact FUT-463 silence', async () => {
    const refused = vi.fn();
    const store: CredentialStore = {
      ...CONNECTED,
      getCredentials: async () => {
        throw new Error('Provider infinitepay is not connected for TENANT:acme');
      },
      getConnectedCredentials: async () => null,
    };
    const gateway = gatewayWith(store, async () => true, { refused });

    await expect(gateway.handleWebhook(MERCHANT, DELIVERY)).rejects.toThrow();

    expect(refused).toHaveBeenCalledOnce();
    const [, reason] = refused.mock.calls[0] as [string, string];
    expect(reason).toContain('not connected');
  });

  it('reports acceptance with the applied count, and the pipeline result is unchanged', async () => {
    const refused = vi.fn();
    const accepted = vi.fn();
    const gateway = gatewayWith(CONNECTED, async () => true, { refused, accepted });

    const events = await gateway.handleWebhook(MERCHANT, DELIVERY);

    expect(events).toHaveLength(1);
    expect(accepted).toHaveBeenCalledWith('infinitepay', 1);
    expect(refused).not.toHaveBeenCalled();
  });

  it('changes nothing when no observer is wired — the pre-FUT-761 behaviour', async () => {
    const gateway = gatewayWith(CONNECTED, async () => true, undefined as never);

    await expect(gateway.handleWebhook(MERCHANT, DELIVERY)).resolves.toHaveLength(1);
  });
});
