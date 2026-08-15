import {
  createMemoryProviderConfigStore,
  createPaymentsHttp,
  createSettingsService,
  defineProviders,
  type MerchantRef,
} from '@12-apps/payments-backend';
import { infinitePayProvider } from '@12-apps/payments-backend/providers/infinitepay';
import { pagbankProvider } from '@12-apps/payments-backend/providers/pagbank';
import { stoneProvider } from '@12-apps/payments-backend/providers/stone';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';
import { describe, expect, it } from 'vitest';

/**
 * The server half of the assertion the frontend harness makes in a browser.
 *
 * the origin host's settings page renders an EMPTY provider list, and the two ends of
 * that page are checked in different places: the frontend harness proves the
 * published UI renders whatever descriptors it is handed, and this proves the
 * published backend produces four of them through its own HTTP handler. A
 * regression in between now has nowhere left to hide.
 *
 * Everything under test is the PUBLISHED package — the registry, the four
 * adapters, the settings service and the HTTP handler are all imported from the
 * installed tarball, not from `packages/`.
 */
const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'harness-tenant' };
const EXPECTED = ['pagbank', 'stone', 'infinitepay', 'stripe'];

function paymentsHttp() {
  const providers = defineProviders({
    pagbank: pagbankProvider(),
    stone: stoneProvider(),
    infinitepay: infinitePayProvider(),
    stripe: stripeProvider(),
  });

  // The store is the in-memory one the package itself publishes for hosts that
  // do not want Prisma. It is not a hand-written fake: swapping it for the
  // Prisma store changes where configs live, not what the catalog contains,
  // and the catalog is what this file is about. The migrations that back the
  // Prisma store get their own check in migrations.test.ts.
  const settings = createSettingsService(providers, createMemoryProviderConfigStore());

  const unused = (name: string) => () => {
    throw new Error(`the backend harness does not exercise ${name}`);
  };

  return createPaymentsHttp({
    settings,
    gateway: { clientConfig: unused('gateway.clientConfig') } as never,
    charges: {} as never,
    resolveChargeRequest: unused('resolveChargeRequest') as never,
  });
}

describe('@12-apps/payments-backend — the settings endpoint offers every registered adapter', () => {
  it('answers 200 with a descriptor per adapter', async () => {
    const response = await paymentsHttp().getSettings({ merchant: MERCHANT });
    expect(response.status).toBe(200);

    const view = (await response.json()) as { providers: { name: string }[] };
    // The exact failure in the origin host is an EMPTY array here, which is why this
    // asserts the names rather than a count: a catalog that silently loses one
    // adapter and a catalog that loses all four are the same bug caught early.
    expect(view.providers.map((provider) => provider.name).sort()).toEqual([...EXPECTED].sort());
  });

  it('gives each descriptor what the settings UI needs to render a card', async () => {
    const response = await paymentsHttp().getSettings({ merchant: MERCHANT });
    const view = (await response.json()) as {
      providers: { name: string; displayName: string; urlSlug: string; authMode: string }[];
    };

    // A descriptor missing displayName still counts in `providers.length` and
    // still renders — as a nameless card. Assert the fields the card is built
    // from, not just that something came back.
    view.providers.forEach((provider) => {
      expect(provider.displayName, `${provider.name} displayName`).toBeTruthy();
      expect(provider.urlSlug, `${provider.name} urlSlug`).toBeTruthy();
      expect(provider.authMode, `${provider.name} authMode`).toBeTruthy();
    });
  });

  it('starts a merchant with no chain, rather than a provider nobody configured', async () => {
    const response = await paymentsHttp().getSettings({ merchant: MERCHANT });
    const view = (await response.json()) as {
      providerChain: string[];
      activeProvider: string | null;
    };

    // Offering an adapter is not the same as having credentials for it. A fresh
    // merchant that came back with an active provider would mean checkout is
    // pointed at an acquirer holding no credentials.
    expect(view.providerChain).toEqual([]);
    expect(view.activeProvider).toBeNull();
  });
});
