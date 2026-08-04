import { describe, expect, it } from 'vitest';

import { checkSnapshot } from '../providers/infinitepay-shared';
import { orderSnapshot } from '../providers/stone-orders';
import { intentSnapshot } from '../providers/stripe-charges';

/**
 * THE ADAPTER CONTRACT THAT KEEPS THE CORE VENDOR-NEUTRAL.
 *
 * A confirmation carries a `ChargeSnapshot`. Until it carried `reference`, the
 * only thing a snapshot could name was the PROVIDER's charge — so every
 * confirmation path had to work backwards to the order through
 * `(provider, providerChargeId)`. What that id means is a per-vendor accident:
 *
 *   PagBank      `CHAR_…`   unique per charge
 *   Stripe       `pi_…`     unique per charge
 *   Stone        `ch_…`     unique per charge
 *   InfinitePay             EQUAL to our reference, on every attempt
 *
 * So the core was correct only by coincidence, and the first vendor that reused
 * an id took a store's checkout down for a week: every attempt on an order
 * collided, nothing could be stored, and nothing could be settled.
 *
 * Each adapter must echo OUR reference back. These tests are where a new
 * provider finds that out — at `pnpm test`, not in production.
 */

describe('every adapter echoes our reference onto the snapshot', () => {
  it('InfinitePay — from `order_nsu`', () => {
    const snapshot = checkSnapshot(
      { success: true, order_nsu: 'order-1', amount: 1290 },
      { reference: 'order-1', currency: 'BRL' },
    );
    expect(snapshot.reference).toBe('order-1');
    // The two being EQUAL here is the whole reason the field is needed.
    expect(snapshot.providerChargeId).toBe(snapshot.reference);
  });

  it('Stone — from the order `code`', () => {
    const snapshot = orderSnapshot(
      { id: 'or_123', code: 'order-2', charges: [{ id: 'ch_9', status: 'paid', amount: 890 }] },
      { currency: 'BRL', method: 'CARD' },
    );
    expect(snapshot.reference).toBe('order-2');
    // Unlike InfinitePay, the provider id is its own — which is exactly why a
    // core keyed on that id cannot be right for both.
    expect(snapshot.providerChargeId).not.toBe(snapshot.reference);
  });

  it('Stripe — from `metadata.reference`', () => {
    const snapshot = intentSnapshot(
      { id: 'pi_123', status: 'succeeded', amount: 590, metadata: { reference: 'order-3' } },
      { currency: 'BRL', method: 'CARD' },
    );
    expect(snapshot.reference).toBe('order-3');
    expect(snapshot.providerChargeId).not.toBe(snapshot.reference);
  });

  it('is absent, not invented, when the payload carries no reference', () => {
    // Optional on purpose: callers fall back to the id lookup, which is exactly
    // today's behaviour. A fabricated reference would settle the wrong order.
    const snapshot = intentSnapshot(
      { id: 'pi_456', status: 'succeeded', amount: 100 },
      { currency: 'BRL', method: 'CARD' },
    );
    expect(snapshot.reference).toBeUndefined();
  });
});
