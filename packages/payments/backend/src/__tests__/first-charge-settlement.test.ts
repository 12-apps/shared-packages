import { describe, expect, it } from 'vitest';

import { classifyFirstCharge } from '../checkout/first-charge';
import type { ChargeSnapshot } from '../core/types';

/**
 * WHAT A FIRST CHARGE TURNED OUT TO BE.
 *
 * The rule under test is one line — asked for PIX and got no link back means
 * answer with the QR — and it has been got wrong in both directions, each time
 * turning a perfectly payable charge into a 500 the buyer could do nothing
 * about. FUT-563 was a PIX request failing over onto a redirect provider;
 * FUT-747 was its mirror, a merchant with no in-browser card path having every
 * PIX charge routed into the hosted branch on the strength of a fact about
 * CARDS.
 *
 * So the cases below are mostly about ROUTING, and the guards that ride with
 * each shape: hosted compares money only, PIX compares the method too.
 */

const AMOUNT = { amountCents: 7500, currency: 'BRL' } as const;

function snapshot(over: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    provider: 'pagbank',
    providerChargeId: 'CHAR_A',
    reference: 'order-1',
    status: 'PENDING',
    amount: AMOUNT,
    method: 'PIX',
    ...over,
  } as ChargeSnapshot;
}

const PIX_PAYLOAD = { qrText: '00020126-emv', expiresAt: '2030-01-01T00:00:00Z' };

describe('routing — decided by the snapshot, never by the chain', () => {
  it('answers a PIX request carrying a QR as PIX', () => {
    const settled = classifyFirstCharge(snapshot({ pix: PIX_PAYLOAD }), {
      amount: AMOUNT,
      method: 'PIX',
    });

    expect(settled.kind).toBe('PIX');
  });

  /**
   * FUT-563. The walk failed over onto a redirect provider, so the honest
   * answer is that provider's link — not a 500 about a missing QR.
   */
  it('answers a PIX request that failed over onto a link as HOSTED', () => {
    const settled = classifyFirstCharge(
      snapshot({ hostedCheckoutUrl: 'https://pay.example/abc' }),
      { amount: AMOUNT, method: 'PIX' },
    );

    expect(settled).toMatchObject({ kind: 'HOSTED', hostedCheckoutUrl: 'https://pay.example/abc' });
  });

  /**
   * FUT-747, the mirror. The caller asking about a CARD merchant with no
   * in-browser tokenization must not drag a PIX charge into the hosted branch:
   * the routing input is the METHOD and the snapshot, and nothing else.
   */
  it('still answers PIX for a QR charge even though the merchant hosts its cards', () => {
    // Same snapshot a PIX-only `NONE` provider returns. Nothing about the
    // merchant's card capability is passed in, because nothing about it applies.
    const settled = classifyFirstCharge(snapshot({ pix: PIX_PAYLOAD }), {
      amount: AMOUNT,
      method: 'PIX',
    });

    expect(settled.kind).toBe('PIX');
  });

  it('answers a CARD request as HOSTED — a card charge raised here has a link', () => {
    const settled = classifyFirstCharge(
      snapshot({ method: 'CARD', hostedCheckoutUrl: 'https://pay.example/abc' }),
      { amount: AMOUNT, method: 'CARD' },
    );

    expect(settled.kind).toBe('HOSTED');
  });

  it('never routes a CARD request to PIX, even on a snapshot carrying a QR', () => {
    // A card charge that came back with a QR and no link is not a QR to show;
    // it is a provider failure, and the hosted branch reports it as one.
    expect(() =>
      classifyFirstCharge(snapshot({ method: 'CARD', pix: PIX_PAYLOAD }), {
        amount: AMOUNT,
        method: 'CARD',
      }),
    ).toThrow(/no hosted-checkout URL/);
  });
});

describe('the guards, one per shape', () => {
  it('refuses a QR for the wrong amount', () => {
    const settled = classifyFirstCharge(
      snapshot({ pix: PIX_PAYLOAD, amount: { amountCents: 9900, currency: 'BRL' } }),
      { amount: AMOUNT, method: 'PIX' },
    );

    expect(settled).toMatchObject({ kind: 'MISMATCH' });
    // The refusal has to NAME the charge — a mismatch nobody can trace to a
    // provider row is an alert with no next step.
    expect(settled).toMatchObject({ charge: { provider: 'pagbank', providerChargeId: 'CHAR_A' } });
  });

  /**
   * A reused link was minted under whichever method the buyer picked FIRST, and
   * they are free to pick another. Comparing the method here is what refused a
   * buyer their own live link (FUT-606).
   */
  it('does NOT compare the method on a hosted charge', () => {
    const settled = classifyFirstCharge(
      snapshot({ method: 'CARD', hostedCheckoutUrl: 'https://pay.example/abc' }),
      { amount: AMOUNT, method: 'PIX' },
    );

    expect(settled.kind).toBe('HOSTED');
  });

  it('DOES compare the method on a PIX charge', () => {
    const settled = classifyFirstCharge(snapshot({ method: 'CARD', pix: PIX_PAYLOAD }), {
      amount: AMOUNT,
      method: 'PIX',
    });

    expect(settled).toMatchObject({ kind: 'MISMATCH' });
  });
});

describe('the correlation and the QR window', () => {
  it("derives the provider's order id rather than making a caller read the payload", () => {
    const settled = classifyFirstCharge(
      snapshot({ pix: PIX_PAYLOAD, settlementHints: { orderId: 'ORDE_A' } }),
      { amount: AMOUNT, method: 'PIX' },
    );

    expect(settled).toMatchObject({
      charge: { provider: 'pagbank', providerChargeId: 'CHAR_A', providerOrderId: 'ORDE_A' },
    });
  });

  it('falls back to the charge id when the provider keys by charge', () => {
    const settled = classifyFirstCharge(snapshot({ pix: PIX_PAYLOAD }), {
      amount: AMOUNT,
      method: 'PIX',
    });

    expect(settled).toMatchObject({ charge: { providerOrderId: 'CHAR_A' } });
  });

  it('keeps the window the provider actually granted', () => {
    const settled = classifyFirstCharge(snapshot({ pix: PIX_PAYLOAD }), {
      amount: AMOUNT,
      method: 'PIX',
    });

    expect(settled).toMatchObject({ expiresAt: '2030-01-01T00:00:00Z' });
  });

  it('invents one only when the provider states none', () => {
    const settled = classifyFirstCharge(
      snapshot({ pix: { qrText: '00020126-emv' } }),
      { amount: AMOUNT, method: 'PIX' },
      { now: () => Date.parse('2026-01-01T00:00:00Z'), pixFallbackTtlMs: 60_000 },
    );

    expect(settled).toMatchObject({ expiresAt: '2026-01-01T00:01:00.000Z' });
  });
});

describe('the two states no caller can answer', () => {
  it('throws for a hosted charge with no link — there is nowhere to send the buyer', () => {
    // Returning the bare payable would strand them on a payment step with no
    // way to pay and no error.
    expect(() =>
      classifyFirstCharge(snapshot({ method: 'CARD' }), { amount: AMOUNT, method: 'CARD' }),
    ).toThrow(/no hosted-checkout URL/);
  });

  it('throws for a PIX charge with no payload', () => {
    expect(() => classifyFirstCharge(snapshot(), { amount: AMOUNT, method: 'PIX' })).toThrow(
      /no PIX payload/,
    );
  });
});
