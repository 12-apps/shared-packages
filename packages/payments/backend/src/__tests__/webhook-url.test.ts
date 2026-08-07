import { describe, expect, it, vi } from 'vitest';

import type { CredentialStore } from '../core/ports';
import { withMerchantRedirectUrl, withMerchantWebhookUrl } from '../core/webhook-url';

/**
 * A provider that reads its webhook destination off the CHARGE can only notify
 * a merchant whose credentials carry that URL. Leaving each host to remember
 * that is what shipped: `notificationUrl` was in no `credentialSchema` and in
 * no OAuth field copy, so every order went out with nowhere to be notified.
 */

const TENANT = { kind: 'TENANT', id: 'client-1' } as const;

function storeWith(fields: Record<string, string>): CredentialStore {
  return {
    providerChain: vi.fn(),
    defaultProvider: vi.fn(),
    getCredentials: vi.fn().mockResolvedValue({ environment: 'PRODUCTION', fields }),
  } as unknown as CredentialStore;
}

describe('withMerchantWebhookUrl', () => {
  it('stamps the resolved URL onto the credentials the adapter reads', async () => {
    const store = withMerchantWebhookUrl(storeWith({ token: 't' }), async () => 'https://host/hook');

    const resolved = await store.getCredentials(TENANT, 'pagbank');

    expect(resolved?.fields).toEqual({ token: 't', notificationUrl: 'https://host/hook' });
  });

  it('passes the merchant and provider to the host resolver', async () => {
    const resolve = vi.fn().mockResolvedValue('https://host/hook');
    await withMerchantWebhookUrl(storeWith({ token: 't' }), resolve).getCredentials(
      TENANT,
      'pagbank',
    );
    expect(resolve).toHaveBeenCalledWith(TENANT, 'pagbank');
  });

  /**
   * The resolver OUT-RANKS the row (FUT-694). Stored-wins was the other way
   * round, and it is what let a `notificationUrl` written through the
   * pre-FUT-694 settings hole keep pointing a store's callbacks at whoever
   * wrote it — indefinitely, since refusing new writes does nothing for the
   * rows already through. The escape hatch that ordering protected is the
   * resolver itself, which is the host's own code.
   */
  it('out-ranks a notificationUrl stored on the row', async () => {
    const store = withMerchantWebhookUrl(
      storeWith({ token: 't', notificationUrl: 'https://collector.attacker/hook' }),
      async () => 'https://host/hook',
    );

    const resolved = await store.getCredentials(TENANT, 'pagbank');

    expect(resolved?.fields['notificationUrl']).toBe('https://host/hook');
  });

  /**
   * A stored value is the FALLBACK, and one merchant depends on it: the
   * PLATFORM's own acquirer connection has no tenant-addressed webhook route,
   * so the resolver's answer for it is permanently null and the URL the host
   * stamps on save is the only address the provider will ever be given.
   */
  it('falls back to a stored URL for a merchant it cannot address', async () => {
    const store = withMerchantWebhookUrl(
      storeWith({ token: 't', notificationUrl: 'https://host/platform-billing/pagbank' }),
      async () => null,
    );

    const resolved = await store.getCredentials(TENANT, 'pagbank');

    expect(resolved?.fields['notificationUrl']).toBe('https://host/platform-billing/pagbank');
  });

  /**
   * A charge that cannot be notified about still beats a charge that never
   * happens, so an unaddressable merchant degrades rather than throws.
   */
  it('leaves credentials untouched when the host cannot address the merchant', async () => {
    const store = withMerchantWebhookUrl(storeWith({ token: 't' }), async () => null);

    expect((await store.getCredentials(TENANT, 'pagbank'))?.fields).toEqual({ token: 't' });
  });

  it('does not consult the resolver for a merchant with no connection', async () => {
    const inner = {
      providerChain: vi.fn(),
      defaultProvider: vi.fn(),
      getCredentials: vi.fn().mockResolvedValue(null),
    } as unknown as CredentialStore;
    const resolve = vi.fn();

    expect(await withMerchantWebhookUrl(inner, resolve).getCredentials(TENANT, 'pagbank')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  /** The decorator must not swallow the rest of the port. */
  it('leaves the routing methods intact', async () => {
    const inner = storeWith({ token: 't' });
    const store = withMerchantWebhookUrl(inner, async () => null);

    await store.providerChain(TENANT);
    await store.defaultProvider(TENANT);

    expect(inner.providerChain).toHaveBeenCalledWith(TENANT);
    expect(inner.defaultProvider).toHaveBeenCalledWith(TENANT);
  });
});

/**
 * The same gap, one field over. `linkPayload` reads `redirectUrl` when it mints
 * an InfinitePay link, but the field was in no `credentialSchema` and populated
 * nowhere — so `redirect_url` went out `undefined` on every link ever created,
 * and a shopper who paid was stranded on InfinitePay's receipt while the
 * store's tab, the one polling for confirmation, had already been left behind.
 */
describe('withMerchantRedirectUrl', () => {
  it('stamps where a hosted checkout must send the buyer back', async () => {
    const store = withMerchantRedirectUrl(
      storeWith({ handle: 'minhaloja' }),
      async () => 'https://host/acme/menu/checkout',
    );

    const resolved = await store.getCredentials(TENANT, 'infinitepay');

    expect(resolved?.fields).toEqual({
      handle: 'minhaloja',
      redirectUrl: 'https://host/acme/menu/checkout',
    });
  });

  /** Same ordering, same reason: a paid shopper goes where the HOST says. */
  it('out-ranks a redirectUrl stored on the row', async () => {
    const store = withMerchantRedirectUrl(
      storeWith({ redirectUrl: 'https://collector.attacker/obrigado' }),
      async () => 'https://host/acme/menu/checkout',
    );

    const resolved = await store.getCredentials(TENANT, 'infinitepay');

    expect(resolved?.fields['redirectUrl']).toBe('https://host/acme/menu/checkout');
  });

  /**
   * A charge that cannot return the buyer is still better than a charge that
   * never happens, so an unresolvable merchant leaves the credentials untouched
   * rather than failing the payment.
   */
  it('leaves the credentials untouched when the host cannot address the merchant', async () => {
    const store = withMerchantRedirectUrl(storeWith({ handle: 'minhaloja' }), async () => null);

    const resolved = await store.getCredentials(TENANT, 'infinitepay');

    expect(resolved?.fields).toEqual({ handle: 'minhaloja' });
  });

  it('composes with the webhook decorator without either shadowing the other', async () => {
    const store = withMerchantRedirectUrl(
      withMerchantWebhookUrl(storeWith({ handle: 'minhaloja' }), async () => 'https://host/hook'),
      async () => 'https://host/acme/menu/checkout',
    );

    expect((await store.getCredentials(TENANT, 'infinitepay'))?.fields).toEqual({
      handle: 'minhaloja',
      notificationUrl: 'https://host/hook',
      redirectUrl: 'https://host/acme/menu/checkout',
    });
  });
});
