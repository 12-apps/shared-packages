import { describe, expect, it } from 'vitest';

import { ACTIVATION_COPY, CONNECT_APPLICATION_COPY, PROVIDER_COPY } from '../locales';
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
