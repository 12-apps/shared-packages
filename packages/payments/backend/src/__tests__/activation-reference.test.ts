import { describe, expect, it } from 'vitest';

import {
  ownsVerificationReference,
  parseVerificationReference,
  verificationReference,
} from '../activation/reference';

/**
 * The reference was constant per store, and InfinitePay dedupes on `order_nsu`
 * — so every activation attempt was handed the FIRST link ever minted, frozen
 * with the `redirect_url` baked in when it was created. On a tunnel that link
 * returned to production forever, and no amount of starting over produced a
 * new one. Two real payments were lost to it.
 */
describe('verificationReference', () => {
  const MERCHANT = '459cbb21-6837-4423-a240-c4a4d6784cd9';

  it('differs per attempt, so a retry mints a genuinely new link', () => {
    const first = verificationReference('infinitepay', MERCHANT, 'a1');
    const second = verificationReference('infinitepay', MERCHANT, 'a2');
    expect(first).not.toBe(second);
  });

  it("still derives from the config's own identity", () => {
    const ref = verificationReference('infinitepay', MERCHANT, 'a1');
    expect(ownsVerificationReference(ref, 'infinitepay', MERCHANT)).toBe(true);
    // Another merchant, or another provider, is refused exactly as before.
    expect(ownsVerificationReference(ref, 'pagbank', MERCHANT)).toBe(false);
    expect(ownsVerificationReference(ref, 'infinitepay', 'someone-else')).toBe(false);
  });

  it('accepts the historic constant form — links minted before this still settle', () => {
    const legacy = verificationReference('infinitepay', MERCHANT);
    expect(legacy).toBe(`verify-infinitepay-${MERCHANT}`);
    expect(ownsVerificationReference(legacy, 'infinitepay', MERCHANT)).toBe(true);
  });

  it('parses the merchant id back out, attempt id and all', () => {
    for (const ref of [
      verificationReference('infinitepay', MERCHANT),
      verificationReference('infinitepay', MERCHANT, 'a1'),
    ]) {
      expect(parseVerificationReference(ref)).toEqual({
        provider: 'infinitepay',
        merchantId: MERCHANT,
      });
    }
  });

  it('answers null for a reference that is not an activation charge at all', () => {
    expect(parseVerificationReference('order-123')).toBeNull();
  });
});
