import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_COPY,
  CONNECT_APPLICATION_COPY,
  PROVIDER_COPY,
  providerCopyPack,
} from '../locales';
import { localeDrift } from './locale-parity';

/**
 * `tsc` already refuses a MISSING key — every pack is typed against its
 * interface on both sides. `localeDrift` covers the drifts it cannot see: an
 * optional key in one locale only, a nested object stubbed empty, and a
 * translation that dropped an interpolated argument.
 *
 * See `locale-parity.ts` for why this package mirrors that assertion locally
 * instead of importing the shared one.
 */
describe('the locale packs', () => {
  it.each([
    ['ACTIVATION_COPY', ACTIVATION_COPY],
    ['CONNECT_APPLICATION_COPY', CONNECT_APPLICATION_COPY],
    ['PROVIDER_COPY', PROVIDER_COPY],
  ])('%s speaks both languages the same way', (name, pack) => {
    expect(localeDrift(pack as never), name).toEqual([]);
  });

  it('keeps the vendor names an owner has to find in a dashboard', () => {
    // Four providers, four dashboards. Translating the name leaves an owner
    // unable to tell which one to open — the same reason the key prefixes and
    // field labels stay verbatim.
    for (const packs of Object.values(PROVIDER_COPY)) {
      expect(packs.stripe.unreachable).toContain('Stripe');
      expect(packs.stone.refused).toContain('Pagar.me');
      expect(packs.pagbank.refused).toContain('PagBank');
      expect(packs.infinitepay.refused).toContain('InfinitePay');
      expect(packs.infinitepay.fields.handle).toContain('InfiniteTag');
      expect(packs.stone.fields.secretKey).toContain('sk_');
      expect(packs.pagbank.fields.googlePayMerchantId).toContain('gatewayMerchantId');
    }
  });

  it('warns in both languages that a wrong tag pays a stranger', () => {
    // The sharpest sentence in the package: a wrong InfiniteTag sends this
    // store's money to somebody else, irreversibly.
    for (const packs of Object.values(PROVIDER_COPY)) {
      const warning = packs.infinitepay.setupGuide.handle.wrongTagPaysAStranger('Acme');
      expect(warning).toContain('Acme');
      expect(warning.length).toBeGreaterThan(80);
    }
  });

  it('says a platform block is ours rather than the store owner\'s', () => {
    // An owner who reads it as their own problem goes looking for a setting
    // that does not exist.
    for (const copy of Object.values(ACTIVATION_COPY)) {
      expect(copy.platformApproval.length).toBeGreaterThan(80);
    }
  });
});

/**
 * The transpose a host hands to a factory.
 *
 * `PROVIDER_COPY` is keyed language-first and a factory takes one adapter's
 * copy, so every host would otherwise rebuild this object inline, four times.
 */
describe('one provider\'s pack, across the languages', () => {
  it.each(['pagbank', 'stone', 'infinitepay', 'stripe'] as const)(
    'plucks %s out of every language without touching the words',
    (provider) => {
      // Identity, not equality: a pluck that COPIED would be a second pack to
      // keep in step with the first, which is the duplication this removes.
      expect(providerCopyPack(provider)['pt-BR']).toBe(PROVIDER_COPY['pt-BR'][provider]);
      expect(providerCopyPack(provider)['en-US']).toBe(PROVIDER_COPY['en-US'][provider]);
    },
  );

  it('covers every adapter the copy interface names', () => {
    // The guard against the real failure mode: a fifth adapter lands, gets a
    // pack in both languages, and nothing here notices it is unreachable. The
    // key set is read off the pack rather than restated, so the day
    // `ProviderCopyPacks` grows this case grows with it.
    const named = Object.keys(PROVIDER_COPY['pt-BR']) as (keyof typeof PROVIDER_COPY['pt-BR'])[];
    for (const provider of named) {
      const pack = providerCopyPack(provider);
      expect(localeDrift(pack as never), provider).toEqual([]);
    }
  });
});
