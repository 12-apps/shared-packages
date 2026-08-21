import { describe, expect, it } from 'vitest';

import { chargeDescription } from '../providers/shared';
import type { ChargeInput } from '../core/types';

function input(over: Partial<ChargeInput> = {}): ChargeInput {
  return {
    reference: 'ORD-4471',
    amount: { amountCents: 1990, currency: 'BRL' },
    method: 'card',
    customer: { name: 'A Buyer', email: 'buyer@example.test' },
    ...over,
  } as ChargeInput;
}

describe('chargeDescription', () => {
  it("sends the host's own words when it wrote some", () => {
    expect(chargeDescription(input({ description: 'Policy renewal' }), 350)).toBe(
      'Policy renewal',
    );
  });

  it('falls back to the bare reference, never to an invented noun', () => {
    // All four adapters used to compose `Pedido ${reference}` themselves, which
    // put one product's Portuguese on every adopter's card statements — and no
    // gate saw it, because the word carries no diacritic. A reference alone is
    // meaningful to whoever reconciles it; a noun for a host that supplied none
    // is the silence this replaces.
    expect(chargeDescription(input(), 350)).toBe('ORD-4471');
  });

  it('treats blank host copy as unwritten rather than as a description', () => {
    expect(chargeDescription(input({ description: '   ' }), 350)).toBe('ORD-4471');
  });

  it("caps at the provider's own limit", () => {
    // 64 for PagBank, 120 InfinitePay, 255 Stone, 350 Stripe — which is why the
    // cap is an argument and not one shared constant.
    expect(chargeDescription(input({ description: 'x'.repeat(200) }), 64)).toHaveLength(64);
    expect(chargeDescription(input({ description: 'x'.repeat(200) }), 255)).toHaveLength(200);
  });
});
