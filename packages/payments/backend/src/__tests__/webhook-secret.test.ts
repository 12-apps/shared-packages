import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialStore } from '../core/ports';
import { withPlatformWebhookSecret } from '../core/webhook-secret';
import { stripeProvider } from '../providers/stripe';
import { PT_BR_STRIPE_COPY } from '../providers/pt-BR';

/**
 * Connect deliveries are signed with the PLATFORM's endpoint secret, and the
 * copy snapshotted into each merchant's fields at connect time goes stale the
 * day the platform rotates it — after which every already-connected store's
 * deliveries are refused, silently, before the durable inbox. The combinator
 * stamps the CURRENT secret at resolve time, `withMerchantWebhookUrl`-style,
 * so rotation is one host-side change instead of every store reconnecting.
 */

const TENANT = { kind: 'TENANT', id: 'client-1' } as const;

function storeWith(fields: Record<string, string>): CredentialStore {
  return {
    providerChain: vi.fn(),
    defaultProvider: vi.fn(),
    getCredentials: vi.fn().mockResolvedValue({ environment: 'PRODUCTION', fields }),
  } as unknown as CredentialStore;
}

describe('withPlatformWebhookSecret', () => {
  it('given a resolving host, when credentials are read, then the current platform secret is stamped', async () => {
    const store = withPlatformWebhookSecret(
      storeWith({ webhookSecret: 'whsec_connect_snapshot' }),
      async () => 'whsec_current',
    );

    const resolved = await store.getCredentials(TENANT, 'stripe');

    expect(resolved?.fields).toEqual({
      webhookSecret: 'whsec_connect_snapshot',
      platformWebhookSecret: 'whsec_current',
    });
  });

  it('given listening reads on the inner store, when the pipeline resolves through them, then every candidate set is stamped', async () => {
    // Webhook verification resolves through `listListeningCredentials` /
    // `getConnectedCredentials`, not `getCredentials` — a stamp only on the
    // charging read would miss the exact path the secret exists for.
    const inner: CredentialStore = {
      ...storeWith({}),
      getConnectedCredentials: vi
        .fn()
        .mockResolvedValue({ environment: 'PRODUCTION', fields: { webhookSecret: 'stale' } }),
      listListeningCredentials: vi.fn().mockResolvedValue([
        { environment: 'PRODUCTION', fields: { webhookSecret: 'stale' } },
        { environment: 'SANDBOX', fields: { webhookSecret: 'stale-sb' } },
      ]),
    };
    const store = withPlatformWebhookSecret(inner, async () => 'whsec_current');

    const connected = await store.getConnectedCredentials?.(TENANT, 'stripe');
    const listening = await store.listListeningCredentials?.(TENANT, 'stripe');

    expect(connected?.fields['platformWebhookSecret']).toBe('whsec_current');
    expect(listening?.map((set) => set.fields['platformWebhookSecret'])).toEqual([
      'whsec_current',
      'whsec_current',
    ]);
    // The merchant's own copy survives beside the stamp — verify accepts either.
    expect(listening?.map((set) => set.fields['webhookSecret'])).toEqual(['stale', 'stale-sb']);
  });

  it('given an inner store without listening reads, then the wrapper does not invent them', () => {
    // Their PRESENCE switches the pipeline onto the multi-candidate path, so
    // a decorator that added them would change routing, not just fields.
    const store = withPlatformWebhookSecret(storeWith({}), async () => 'whsec_current');

    expect(store.getConnectedCredentials).toBeUndefined();
    expect(store.listListeningCredentials).toBeUndefined();
  });

  it('given a stale stamped copy stored on the row, when the host resolves, then the resolver out-ranks it', async () => {
    // Same ordering as the URL combinators (FUT-694): the secret belongs to
    // the deployment, and a stored value must not outlive a rotation.
    const store = withPlatformWebhookSecret(
      storeWith({ platformWebhookSecret: 'whsec_rotated_away' }),
      async () => 'whsec_current',
    );

    const resolved = await store.getCredentials(TENANT, 'stripe');

    expect(resolved?.fields['platformWebhookSecret']).toBe('whsec_current');
  });

  it('given a host with no platform endpoint for this provider, then the credentials pass untouched', async () => {
    const store = withPlatformWebhookSecret(
      storeWith({ webhookSecret: 'whsec_own' }),
      async () => null,
    );

    const resolved = await store.getCredentials(TENANT, 'stone');

    expect(resolved?.fields).toEqual({ webhookSecret: 'whsec_own' });
  });

  it('given a merchant with no connection, then the resolver is never consulted', async () => {
    const inner = {
      providerChain: vi.fn(),
      defaultProvider: vi.fn(),
      getCredentials: vi.fn().mockResolvedValue(null),
    } as unknown as CredentialStore;
    const resolve = vi.fn();

    const resolved = await withPlatformWebhookSecret(inner, resolve).getCredentials(
      TENANT,
      'stripe',
    );

    expect(resolved).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('given a platform rotation, when a delivery signed with the current secret resolves through the stamped store, then stripe verifies it', async () => {
    // The end-to-end point of the combinator: the row still holds the
    // connect-time snapshot, the platform has moved on, and the delivery is
    // signed by the CURRENT secret — only the stamp can authenticate it.
    const store = withPlatformWebhookSecret(
      storeWith({ webhookSecret: 'whsec_connect_snapshot' }),
      async () => 'whsec_rolled',
    );
    const resolved = await store.getCredentials(TENANT, 'stripe');
    const rawBody = JSON.stringify({ id: 'evt_1', type: 'other' });
    const mac = createHmac('sha256', 'whsec_rolled').update(`1700000000.${rawBody}`).digest('hex');

    await expect(
      stripeProvider(PT_BR_STRIPE_COPY).webhook.verify(
        {
          provider: 'stripe',
          rawBody,
          headers: { 'stripe-signature': `t=1700000000,v1=${mac}` },
        },
        resolved ?? { environment: 'PRODUCTION', fields: {} },
      ),
    ).resolves.toBe(true);
  });
});
