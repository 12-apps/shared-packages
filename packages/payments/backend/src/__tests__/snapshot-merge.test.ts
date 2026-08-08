import { describe, expect, it } from 'vitest';

import { mergeRefreshedSnapshot } from '../core/snapshot-merge';
import type { ChargeSnapshot } from '../core/types';

/**
 * Unit (FUT-669): what a REFRESH of a charge may change about the stored one.
 *
 * The refresh used to replace the row wholesale, and on a redirect provider
 * that is a demolition: `payment_check` answers an unpaid charge with no
 * amount and no checkout URL, so one poll of the buyer's own screen turned a
 * payable row into `0 cents, no link`. Reuse could then offer nothing back and
 * the next attempt minted a SECOND live page for an unchanged basket — two
 * payable links on one order, which is the double-payment exposure the PIX
 * path has always refused to create.
 */

/** The row a redirect provider's `createCharge` writes. */
const CREATED: ChargeSnapshot = {
  provider: 'infinitepay',
  providerChargeId: 'ord_1',
  reference: 'ord_1',
  status: 'PENDING',
  amount: { amountCents: 1290, currency: 'BRL' },
  method: 'CARD',
  hostedCheckoutUrl: 'https://checkout.example/pay/ord_1',
  settlementHints: { slug: 'gmTq1EgYrP' },
};

/** What `getCharge` answers about that charge while nobody has paid it. */
const UNPAID_REREAD: ChargeSnapshot = {
  provider: 'infinitepay',
  providerChargeId: 'ord_1',
  status: 'PENDING',
  amount: { amountCents: 0, currency: 'BRL' },
  method: 'PIX',
};

describe('mergeRefreshedSnapshot — an unpaid re-read', () => {
  it('keeps the checkout link the buyer still has to pay', () => {
    // The whole point. A row without a link is a row reuse cannot offer, and
    // the next attempt mints a second payable page for the same basket.
    expect(mergeRefreshedSnapshot(CREATED, UNPAID_REREAD).hostedCheckoutUrl).toBe(
      'https://checkout.example/pay/ord_1',
    );
  });

  it('keeps what the charge is worth — 0 means NOT CAPTURED, not free', () => {
    const merged = mergeRefreshedSnapshot(CREATED, UNPAID_REREAD);

    expect(merged.amount).toEqual({ amountCents: 1290, currency: 'BRL' });
  });

  it("keeps the method, because an adapter's fallback is not an observation", () => {
    // The re-read says PIX only because that is the default when there is
    // nothing to report. Nobody has chosen anything yet.
    expect(mergeRefreshedSnapshot(CREATED, UNPAID_REREAD).method).toBe('CARD');
  });

  it('keeps the reference that names the order', () => {
    expect(mergeRefreshedSnapshot(CREATED, UNPAID_REREAD).reference).toBe('ord_1');
  });

  it('still takes the refreshed STATUS — that is what a refresh is for', () => {
    const expired: ChargeSnapshot = { ...UNPAID_REREAD, status: 'EXPIRED' };

    expect(mergeRefreshedSnapshot(CREATED, expired).status).toBe('EXPIRED');
  });
});

describe('mergeRefreshedSnapshot — a settled re-read', () => {
  const PAID: ChargeSnapshot = {
    provider: 'infinitepay',
    providerChargeId: 'ord_1',
    status: 'PAID',
    amount: { amountCents: 1000, currency: 'BRL' },
    method: 'PIX',
  };

  it('takes the CAPTURED amount, even when it is less than we asked', () => {
    // Non-negotiable (FUT-373): the shortfall guard compares what the provider
    // really captured against what the order costs. Preserving our own figure
    // here would make it compare a number with itself and settle any underpay.
    const merged = mergeRefreshedSnapshot(CREATED, PAID);

    expect(merged.amount.amountCents).toBe(1000);
    expect(merged.status).toBe('PAID');
  });

  it('takes how it was ACTUALLY paid', () => {
    // On a redirect provider this is the first moment anyone knows: the buyer
    // chose on the provider's page, not on ours.
    expect(mergeRefreshedSnapshot(CREATED, PAID).method).toBe('PIX');
  });
});

describe('mergeRefreshedSnapshot — everything the refresh does report wins', () => {
  it('accumulates settlement hints instead of dropping the older half', () => {
    // The `slug` is learned at creation and the `transaction_nsu` only on the
    // return trip; InfinitePay confirms nothing without BOTH, so a refresh
    // carrying one must not discard the other.
    const returned: ChargeSnapshot = {
      ...UNPAID_REREAD,
      settlementHints: { transactionNsu: '99887766' },
    };

    expect(mergeRefreshedSnapshot(CREATED, returned).settlementHints).toEqual({
      slug: 'gmTq1EgYrP',
      transactionNsu: '99887766',
    });
  });

  it('replaces an instrument the refresh actually carries', () => {
    // Additive means "fill the gaps", never "prefer the old value".
    const reissued: ChargeSnapshot = {
      ...UNPAID_REREAD,
      hostedCheckoutUrl: 'https://checkout.example/pay/ord_1-reissued',
    };

    expect(mergeRefreshedSnapshot(CREATED, reissued).hostedCheckoutUrl).toBe(
      'https://checkout.example/pay/ord_1-reissued',
    );
  });

  it('takes a non-zero amount from an unsettled refresh', () => {
    // A provider that DOES report an amount before settlement is telling us
    // something; only silence (0) falls back to what we stored.
    const repriced: ChargeSnapshot = {
      ...UNPAID_REREAD,
      amount: { amountCents: 2580, currency: 'BRL' },
    };

    expect(mergeRefreshedSnapshot(CREATED, repriced).amount.amountCents).toBe(2580);
  });

  it('keeps a live QR through an unpaid re-read', () => {
    // The PIX counterpart: the QR IS the charge, and a poll that erased it
    // would strand a buyer holding a code the store no longer knows about.
    const withQr: ChargeSnapshot = {
      ...CREATED,
      method: 'PIX',
      hostedCheckoutUrl: undefined,
      pix: { qrText: '00020126-live', expiresAt: '2030-01-01T00:00:00Z' },
    };

    expect(mergeRefreshedSnapshot(withQr, UNPAID_REREAD).pix?.qrText).toBe('00020126-live');
  });

  it('keeps what the charge was worth through a terminal-but-unpaid refresh', () => {
    // An EXPIRED PIX order (FUT-681) carries no charge and so no amount: the
    // provider is silent about money, not retracting it. Zeroing the row here
    // would erase what the order was for — the number the retry screen and
    // every report still needs.
    const expired: ChargeSnapshot = {
      ...UNPAID_REREAD,
      status: 'EXPIRED',
    };

    const merged = mergeRefreshedSnapshot(CREATED, expired);
    expect(merged.status).toBe('EXPIRED');
    expect(merged.amount).toEqual({ amountCents: 1290, currency: 'BRL' });
  });
});
