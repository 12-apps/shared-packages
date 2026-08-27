import { describe, expect, it } from 'vitest';

import { toShortPaymentRows, type ShortPaymentOutcomeCopy } from '../rows';
import type { LedgerFormatters, ShortPaymentWire } from '../wire';

/**
 * The short-payment queue's projection.
 *
 * Three of its decisions have each been wrong in production, and none of them
 * is obvious enough to survive being written a second time by hand.
 */

const FORMAT: LedgerFormatters = {
  amount: (cents) => `${cents}c`,
  dateTime: (iso) => `at ${iso}`,
  placeholder: '—',
};

const COPY: ShortPaymentOutcomeCopy = {
  resolution: { SETTLED: 'Collected the difference', REFUNDED: 'Refunded at the provider' },
  orderStatus: { FAILED: 'To reconcile', PAID: 'Resolved' },
};

function wire(overrides: Partial<ShortPaymentWire> = {}): ShortPaymentWire {
  return {
    id: 'sp_1',
    detectedAt: '2026-08-01T10:00:00.000Z',
    orderId: 'ord_1',
    orderStatus: 'FAILED',
    capturedCents: 900,
    expectedCents: 1000,
    shortfallCents: 100,
    method: 'CARD',
    providerChargeId: 'ch_1',
    payment: null,
    resolution: null,
    resolvedAt: null,
    ...overrides,
  };
}

const only = (entry: ShortPaymentWire) => toShortPaymentRows([entry], FORMAT, COPY)[0]!;

describe('which amount is “captured”', () => {
  it('is the audit diff when it carries one', () => {
    expect(only(wire()).capturedLabel).toBe('900c');
  });

  /**
   * Same money, two witnesses. Reading only the diff printed a dash over a
   * capture that had really happened — on the one screen whose job is to say
   * how much money arrived.
   */
  it('falls back to the payment row the diff was joined to', () => {
    const row = only(
      wire({
        capturedCents: null,
        payment: { id: 'p1', status: 'PAID', amountCents: 850, createdAt: '2026-08-01' },
      }),
    );
    expect(row.capturedLabel).toBe('850c');
  });

  it('says so plainly when neither witness carries it', () => {
    expect(only(wire({ capturedCents: null, payment: null })).capturedLabel).toBe('—');
  });
});

describe('what the row’s situation is', () => {
  it('reads the order status while nobody has decided', () => {
    expect(only(wire()).outcomeLabel).toBe('To reconcile');
  });

  /**
   * A refunded shortfall leaves the order FAILED forever. Reading the status
   * alone therefore keeps calling finished work unreconciled — which is also
   * why a sidebar badge counting this queue has to subtract decisions.
   */
  it('shows an operator’s decision INSTEAD of the status, not beside it', () => {
    const row = only(wire({ resolution: 'REFUNDED', orderStatus: 'FAILED' }));
    expect(row.outcomeLabel).toBe('Refunded at the provider');
  });

  it('passes through a state this package has not met, rather than blanking it', () => {
    expect(only(wire({ orderStatus: 'CHARGEBACK' })).outcomeLabel).toBe('CHARGEBACK');
    expect(only(wire({ resolution: 'DISPUTED' })).outcomeLabel).toBe('DISPUTED');
  });
});

describe('whether the row is still work', () => {
  it('is, while nobody has decided and the order has not settled', () => {
    expect(only(wire()).pending).toBe(true);
  });

  it('is not, once a decision is recorded', () => {
    expect(only(wire({ resolution: 'SETTLED' })).pending).toBe(false);
  });

  it('is not, when the order settled on its own', () => {
    expect(only(wire({ orderStatus: 'PAID' })).pending).toBe(false);
  });
});
