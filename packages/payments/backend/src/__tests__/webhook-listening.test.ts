import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { WebhookVerificationError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import type { CredentialStore } from '../core/ports';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import type { MerchantRef, PaymentEnvironment, ResolvedCredentials, WebhookDelivery } from '../core/types';
import { credentialStoreFrom } from '../config/service';
import type { StoredProviderConfig } from '../config/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryProviderConfigStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { pagbankProvider } from '../providers/pagbank';

/**
 * Charging and listening are different questions (FUT-463).
 *
 * Enablement decides where a NEW charge is routed. A delivery is about money
 * that has ALREADY moved, so the provider's willingness to tell us about it has
 * nothing to do with whether the owner currently wants new orders going there.
 *
 * The single gate cost real money twice. The ACTIVATION charge is paid while
 * the provider is by definition not enabled — enabling is what the charge earns
 * — so its confirmation was refused before `webhook.verify` could run. And an
 * owner pausing a provider with a PIX outstanding had every notification for it
 * refused, so those orders never confirmed. Neither left a trace: verification
 * precedes the inbox, so a delivery refused here is never recorded anywhere.
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
      parse: async () => [],
    },
    clientConfig: () => ({ provider: 'infinitepay', tokenization: 'REDIRECT' }),
  } as unknown as PaymentProviderAdapter;
}

/** A store whose provider is CONNECTED but not enabled — mid-activation. */
function connectedButDisabled(): CredentialStore {
  return {
    providerChain: async () => [],
    defaultProvider: async () => null,
    getCredentials: async () => {
      throw new Error('Provider infinitepay is configured but not enabled');
    },
    getConnectedCredentials: async () => CREDS,
  };
}

function gatewayWith(store: CredentialStore, verify: () => Promise<boolean>) {
  const verifyFn = vi.fn(verify);
  return {
    verifyFn,
    gateway: createPaymentsGateway({
      providers: { get: () => adapter(verifyFn) } as never,
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
    } as never),
  };
}

describe('inbound webhooks for a provider that is not enabled', () => {
  it('verifies the delivery instead of refusing it at the credential lookup', async () => {
    const { gateway, verifyFn } = gatewayWith(connectedButDisabled(), async () => true);

    await gateway.handleWebhook(MERCHANT, {
      provider: 'infinitepay',
      rawBody: '{"order_nsu":"verify-infinitepay-acme","paid":true}',
      headers: {},
    });

    // The point: it got as far as asking. Before, `getCredentials` threw first
    // and the activation confirmation died with nothing recorded.
    expect(verifyFn).toHaveBeenCalledOnce();
  });

  it('still refuses a provider that is not connected at all', async () => {
    const store: CredentialStore = {
      ...connectedButDisabled(),
      getConnectedCredentials: async () => null,
    };
    const { gateway, verifyFn } = gatewayWith(store, async () => true);

    await expect(
      gateway.handleWebhook(MERCHANT, {
        provider: 'infinitepay',
        rawBody: '{}',
        headers: {},
      }),
    ).rejects.toThrow(/not connected/);
    expect(verifyFn).not.toHaveBeenCalled();
  });
});

/**
 * The invoice code `payment_check` insists on is not a FIELD (FUT-463).
 *
 * `POST /links` answers with exactly one key — `{"url": "…/handle/gmTq1EgYrP"}`
 * — and the code is that last path segment. Reading a `slug` property that is
 * never sent left the hint empty, so every confirmation asked a question
 * InfinitePay will not answer and got "not paid" back for payments that had
 * plainly happened.
 */
describe('the InfinitePay invoice slug', () => {
  it('comes out of the checkout URL, since the response carries no slug field', async () => {
    const { infinitePayProvider } = await import('../providers/infinitepay');
    const fetched: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        fetched.push({ url: String(url), body: JSON.parse(init.body) as unknown });
        return new Response(
          JSON.stringify({ url: 'https://checkout.infinitepay.io/thompson-moreira/gmTq1EgYrP' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const snapshot = await infinitePayProvider().createCharge(
      {
        reference: 'order-1',
        amount: { amountCents: 101, currency: 'BRL' },
        method: 'PIX',
        customer: { name: '', email: '' },
      } as never,
      { environment: 'PRODUCTION', fields: { handle: 'thompson-moreira' }, stub: false },
    );

    expect(snapshot.settlementHints?.slug).toBe('gmTq1EgYrP');
    vi.unstubAllGlobals();
  });

  /**
   * The `?lenc=<blob>` form carries the handle alone. A handle passed off as an
   * invoice code would be a confidently wrong answer where none is honest — the
   * webhook still carries the real one.
   */
  it('claims no slug when the URL has none to give', async () => {
    const { infinitePayProvider } = await import('../providers/infinitepay');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ url: 'https://checkout.infinitepay.io/thompson-moreira?lenc=G3oBAI' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const snapshot = await infinitePayProvider().createCharge(
      {
        reference: 'order-2',
        amount: { amountCents: 101, currency: 'BRL' },
        method: 'PIX',
        customer: { name: '', email: '' },
      } as never,
      { environment: 'PRODUCTION', fields: { handle: 'thompson-moreira' }, stub: false },
    );

    expect(snapshot.settlementHints).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

/**
 * `payment_check` wants all four fields — measured against the live API.
 *
 *     {handle, order_nsu, transaction_nsu, slug} → {"success":true,"paid":true,…}
 *     missing `slug`            → {"success":false}
 *     missing `transaction_nsu` → {"success":false}
 *     a reference never created → {"success":false}
 *
 * The last line is why a partial question is not merely weaker: its answer is
 * IDENTICAL to nonsense, at HTTP 200. So the adapter must send everything it
 * holds, and this pins that it does.
 */
describe('payment_check carries every hint it was given', () => {
  it('sends the slug and the transaction id together', async () => {
    const { infinitePayProvider } = await import('../providers/infinitepay');
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body) as Record<string, unknown>);
        return new Response(JSON.stringify({ success: true, paid: true, amount: 101 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const snapshot = await infinitePayProvider().findChargeByReference?.(
      'order-9',
      { environment: 'PRODUCTION', fields: { handle: 'thompson-moreira' }, stub: false },
      { slug: 'HN1QkSYx6k', transactionNsu: '79c778f0-0fbe-408c-b610-7a43b6ecb10e' },
    );

    expect(sent[0]).toEqual({
      handle: 'thompson-moreira',
      order_nsu: 'order-9',
      slug: 'HN1QkSYx6k',
      transaction_nsu: '79c778f0-0fbe-408c-b610-7a43b6ecb10e',
    });
    expect(snapshot?.status).toBe('PAID');
    vi.unstubAllGlobals();
  });
});

/**
 * FUT-678 — a delivery signed under the environment a store just flipped AWAY
 * from must still authenticate. Verification precedes the durable inbox, so a
 * sandbox delivery in flight during a SANDBOX→PRODUCTION flip that only the
 * production secret is tried against dies with no row, no replay and no trace.
 * The credential store answers with EVERY environment's sets
 * (`listListeningCredentials`) and the pipeline tries each in order.
 */
describe('webhook verification across both environments', () => {
  const ORDER_BODY = JSON.stringify({
    id: 'ORDE_1',
    reference_id: 'order-1',
    charges: [{ id: 'CHAR_1', status: 'PAID', amount: { value: 12_50 } }],
  });

  function signedDelivery(secret: string): WebhookDelivery {
    return {
      provider: 'pagbank',
      rawBody: ORDER_BODY,
      headers: {
        'x-authenticity-token': createHash('sha256')
          .update(`${secret}-${ORDER_BODY}`)
          .digest('hex'),
      },
    };
  }

  /** A PagBank connection holding BOTH environments' account tokens. */
  function bothEnvironments(active: PaymentEnvironment): StoredProviderConfig {
    return {
      provider: 'pagbank',
      enabled: true,
      priority: 0,
      environment: active,
      status: 'UNVERIFIED',
      lastVerifiedAt: null,
      chargeVerifiedAt: null,
      pendingVerification: null,
      expiresAt: null,
      stub: false,
      environments: {
        SANDBOX: { token: 'sandbox-token' },
        PRODUCTION: { token: 'production-token' },
      },
    };
  }

  function connectWorld(behavior: { handlerFails: boolean }) {
    const configStore = createMemoryProviderConfigStore();
    const webhooks = createMemoryWebhookInbox();
    const gateway = createPaymentsGateway({
      providers: defineProviders({ pagbank: pagbankProvider() } as const),
      credentials: credentialStoreFrom(configStore),
      charges: createMemoryChargeStore(),
      webhooks,
      attempts: createMemoryAttemptLedger(),
      onWebhookEvent: async () => {
        if (behavior.handlerFails) throw new Error('host handler down');
      },
    });
    return { configStore, webhooks, gateway };
  }

  it('verifies a sandbox-signed delivery arriving after the flip to PRODUCTION', async () => {
    const world = connectWorld({ handlerFails: false });
    await world.configStore.save(MERCHANT, bothEnvironments('PRODUCTION'));

    const events = await world.gateway.handleWebhook(MERCHANT, signedDelivery('sandbox-token'));

    expect(events[0]).toMatchObject({
      type: 'CHARGE_UPDATED',
      charge: { providerChargeId: 'CHAR_1', status: 'PAID' },
    });
  });

  it('still rejects a delivery signed with neither environment secret', async () => {
    const world = connectWorld({ handlerFails: false });
    await world.configStore.save(MERCHANT, bothEnvironments('PRODUCTION'));

    await expect(
      world.gateway.handleWebhook(MERCHANT, signedDelivery('forged-secret')),
    ).rejects.toThrow(WebhookVerificationError);
  });

  it('replays a stranded sandbox-signed row after the store flipped to PRODUCTION', async () => {
    // The replay sweep is the recovery path for exactly this row: recorded
    // before the flip, failed on a host blip, and re-verified AFTER the store
    // moved on — with only the active secret it would re-reject forever.
    const behavior = { handlerFails: true };
    const world = connectWorld(behavior);
    await world.configStore.save(MERCHANT, bothEnvironments('SANDBOX'));
    await expect(
      world.gateway.handleWebhook(MERCHANT, signedDelivery('sandbox-token')),
    ).rejects.toThrow('host handler down');

    await world.configStore.save(MERCHANT, bothEnvironments('PRODUCTION'));
    behavior.handlerFails = false;
    const [rowId] = Object.keys(world.webhooks.statuses());
    world.webhooks.backdate(rowId!, new Date('2026-07-27T11:00:00Z'));

    const report = await world.gateway.replayWebhooks({ now: new Date('2026-07-27T12:00:00Z') });

    expect(report).toMatchObject({ attempted: 1, processed: 1, failed: 0 });
  });
});

/**
 * A webhook secret must never gate an InfinitePay delivery.
 *
 * InfinitePay sends no configurable headers, so a stored `webhookSecret` could
 * only ever reject GENUINE deliveries — a production store had one configured
 * and every notification InfinitePay sent it bounced at that gate, before
 * `payment_check` could run. The network re-ask IS the verification.
 */
describe('InfinitePay webhook verification with a stored secret', () => {
  it('believes a delivery the provider confirms, secret or no secret', async () => {
    const { infinitePayProvider } = await import('../providers/infinitepay');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, paid: true, amount: 101 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const verified = await infinitePayProvider().webhook.verify(
      {
        provider: 'infinitepay',
        rawBody: JSON.stringify({
          order_nsu: 'verify-infinitepay-acme',
          transaction_nsu: 'tx-1',
          invoice_slug: 'inv-1',
          amount: 101,
        }),
        // No x-webhook-secret header — InfinitePay cannot send one.
        headers: {},
      },
      {
        environment: 'PRODUCTION',
        fields: { handle: 'acme', webhookSecret: 'configured-but-unusable' },
        stub: false,
      },
    );

    expect(verified).toBe(true);
    vi.unstubAllGlobals();
  });
});
