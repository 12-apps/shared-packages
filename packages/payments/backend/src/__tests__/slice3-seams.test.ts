import { describe, expect, it } from 'vitest';

import {
  attributedCard,
  chainTokenizesInBrowser,
  holdsInstrumentFor,
} from '../core/card-instrument';
import { chargeDeadlinePassed, hostedChargePayable, pixChargePayable } from '../core/charge-reuse';
import { classifyReversalEvent } from '../core/reversal';
import type { ChargeSnapshot } from '../core/types';
import type { NormalizedWebhookEvent } from '../core/webhook-event-types';

/** A charge snapshot with only the fields these predicates read. */
function snapshot(over: Partial<ChargeSnapshot>): ChargeSnapshot {
  return {
    provider: 'pagbank',
    providerChargeId: 'CHAR_1',
    status: 'PENDING',
    amount: { amountCents: 1000, currency: 'BRL' },
    method: 'PIX',
    ...over,
  } as ChargeSnapshot;
}

function event(over: Partial<NormalizedWebhookEvent>): NormalizedWebhookEvent {
  return { provider: 'pagbank', eventId: 'evt-1', type: 'CHARGE_UPDATED', ...over };
}

describe('classifyReversalEvent', () => {
  it('reads a dispute off the raw detail, since it carries no snapshot', () => {
    const facts = classifyReversalEvent(
      event({ type: 'DISPUTE_UPDATED', raw: { reference: 'ord-1', transactionCode: 'TX_9' } }),
    );
    expect(facts).toEqual({ kind: 'DISPUTE', reference: 'ord-1', providerChargeId: 'TX_9' });
  });

  it('still reports a dispute whose detail names nothing', () => {
    // The host decides what to do with an unattributable dispute (log it, drop
    // it); classifying it as "not a reversal" would hide it entirely.
    expect(classifyReversalEvent(event({ type: 'DISPUTE_UPDATED', raw: {} }))).toEqual({
      kind: 'DISPUTE',
      reference: null,
      providerChargeId: null,
    });
  });

  it('reads a refund off a charge snapshot that says REFUNDED', () => {
    const facts = classifyReversalEvent(
      event({
        charge: snapshot({
          status: 'REFUNDED',
          reference: 'ord-2',
          providerChargeId: 'CHAR_2',
          amount: { amountCents: 750, currency: 'BRL' },
        }),
      }),
    );
    expect(facts).toEqual({
      kind: 'REFUND',
      reference: 'ord-2',
      providerChargeId: 'CHAR_2',
      refundedCents: 750,
    });
  });

  it('reads a refund off the LEDGER fact for a provider that only announces one', () => {
    const facts = classifyReversalEvent(
      event({
        type: 'REFUND_UPDATED',
        refund: {
          provider: 'pagbank',
          providerChargeId: 'CHAR_3',
          providerRefundId: 'REF_3',
          reference: 'ord-3',
          status: 'REFUNDED',
          amount: { amountCents: 500, currency: 'BRL' },
        },
      }),
    );
    expect(facts).toEqual({
      kind: 'REFUND',
      reference: 'ord-3',
      providerChargeId: 'CHAR_3',
      refundedCents: 500,
    });
  });

  it('reports a null reference rather than refusing, so the host can fall back', () => {
    const facts = classifyReversalEvent(
      event({ charge: snapshot({ status: 'REFUNDED', providerChargeId: 'CHAR_4' }) }),
    );
    expect(facts).toMatchObject({ kind: 'REFUND', reference: null, providerChargeId: 'CHAR_4' });
  });

  it.each([
    ['a paid charge', event({ charge: snapshot({ status: 'PAID' }) })],
    ['a PARTIALLY_REFUNDED charge', event({ charge: snapshot({ status: 'PARTIALLY_REFUNDED' }) })],
    [
      'a refund still pending',
      event({
        type: 'REFUND_UPDATED',
        refund: {
          provider: 'pagbank',
          providerChargeId: 'CHAR_5',
          providerRefundId: 'REF_5',
          status: 'PENDING',
          amount: { amountCents: 100, currency: 'BRL' },
        },
      }),
    ],
    ['an unknown event', event({ type: 'UNKNOWN' })],
  ])('reverses nothing for %s', (_case, delivered) => {
    expect(classifyReversalEvent(delivered as NormalizedWebhookEvent)).toBeNull();
  });
});

describe('chargeDeadlinePassed', () => {
  const NOW = Date.parse('2026-01-01T12:00:00Z');

  it('is past only for a deadline that has actually elapsed', () => {
    expect(chargeDeadlinePassed('2026-01-01T11:59:59Z', NOW)).toBe(true);
    expect(chargeDeadlinePassed('2026-01-01T12:00:01Z', NOW)).toBe(false);
  });

  it('fails OPEN for an absent or unreadable deadline', () => {
    // Neither says the code lapsed, and treating either as expired strands a
    // buyer whose QR is fine.
    expect(chargeDeadlinePassed(undefined, NOW)).toBe(false);
    expect(chargeDeadlinePassed('whenever', NOW)).toBe(false);
  });
});

describe('pixChargePayable', () => {
  const NOW = Date.parse('2026-01-01T12:00:00Z');

  it('is payable with a live QR', () => {
    expect(pixChargePayable(snapshot({ pix: { qrText: 'QR' } }), NOW)).toBe(true);
  });

  it('is not payable when the status column says PENDING but no QR was stored', () => {
    expect(pixChargePayable(snapshot({}), NOW)).toBe(false);
    expect(pixChargePayable(snapshot({ pix: { qrText: '' } }), NOW)).toBe(false);
  });

  it('is not payable once the QR has lapsed', () => {
    expect(
      pixChargePayable(snapshot({ pix: { qrText: 'QR', expiresAt: '2026-01-01T11:00:00Z' } }), NOW),
    ).toBe(false);
  });
});

describe('hostedChargePayable', () => {
  it('needs a link, and asks nothing about expiry', () => {
    // A hosted provider keeps its page alive on its own schedule, so there is
    // no honest local expiry test to apply.
    expect(hostedChargePayable(snapshot({ hostedCheckoutUrl: 'https://pay.example/x' }))).toBe(true);
    expect(hostedChargePayable(snapshot({}))).toBe(false);
  });
});

describe('chainTokenizesInBrowser', () => {
  it('is true when ANY provider in the chain tokenizes in the browser', () => {
    // The head is not entitled to answer alone: hiding the form because the
    // head is hosted means the chain is never walked.
    expect(
      chainTokenizesInBrowser([{ tokenization: 'REDIRECT' }, { tokenization: 'PUBLIC_KEY' }]),
    ).toBe(true);
    expect(chainTokenizesInBrowser([{ tokenization: 'SDK' }])).toBe(true);
  });

  it('is false for an all-hosted chain and for an empty one', () => {
    expect(chainTokenizesInBrowser([{ tokenization: 'REDIRECT' }])).toBe(false);
    expect(chainTokenizesInBrowser([])).toBe(false);
  });
});

describe('holdsInstrumentFor', () => {
  it('answers from the MAP when the browser minted per provider', () => {
    const card = { tokensByProvider: { stripe: 'tok_stripe' } };
    expect(holdsInstrumentFor(card, 'stripe')).toBe(true);
    // The hosted provider we minted nothing for — so a live link at IT is
    // still the honest answer to a re-tap.
    expect(holdsInstrumentFor(card, 'pagbank')).toBe(false);
  });

  it('falls back to the bare instrument when no map was minted', () => {
    expect(holdsInstrumentFor({ token: 'tok' }, 'pagbank')).toBe(true);
    expect(holdsInstrumentFor({ savedCardToken: 'vault_1' }, 'pagbank')).toBe(true);
    expect(holdsInstrumentFor({}, 'pagbank')).toBe(false);
    expect(holdsInstrumentFor(undefined, 'pagbank')).toBe(false);
  });
});

describe('attributedCard', () => {
  it('sends ONLY the map, dropping the bare token that would default to the head', () => {
    expect(attributedCard({ token: 'bare', tokensByProvider: { stripe: 'tok_s' } })).toEqual({
      tokensByProvider: { stripe: 'tok_s' },
    });
  });

  it('leaves a saved card untouched — its owner is whoever vaulted it', () => {
    const card = { savedCardToken: 'vault_1', tokensByProvider: { stripe: 'tok_s' } };
    expect(attributedCard(card)).toBe(card);
  });

  it('passes through when there is no map to be complete about', () => {
    // An EMPTY map states nothing, so the block is handed on as it came —
    // dropping the bare token there would leave the charge with no instrument
    // at all.
    const bare = { token: 'bare' };
    expect(attributedCard(bare)).toBe(bare);
    const emptyMap = { token: 'bare', tokensByProvider: {} };
    expect(attributedCard(emptyMap)).toBe(emptyMap);
    expect(attributedCard(undefined)).toBeUndefined();
  });
});
