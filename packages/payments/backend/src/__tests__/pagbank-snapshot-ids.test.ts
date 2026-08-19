import { afterEach, describe, expect, it, vi } from 'vitest';

import { pagbankProvider } from '../providers/pagbank';

import { cardInput, pixInput } from './fixtures';

/**
 * The IDS a PagBank snapshot carries, and which field each one lands in.
 *
 * One card response holds THREE different identifiers — the order container,
 * the charge inside it, and the id of the card PagBank agreed to store — and
 * nothing pinned which is which. `pagbank.test.ts` covers this adapter's
 * amounts, declines, QR and webhook signing, but never asserts any of the
 * three, so a mapping that swapped two of them stayed green.
 *
 * That gap had a consumer: an adopter re-derived two of them from
 * `snapshot.raw` in its own code, which meant a HOST's tests were the only
 * thing exercising the rule — for one adopter, in another repo, against
 * fixtures it wrote itself. Dropping that host code in favour of the
 * normalized fields (FUT-760) is what makes these assertions the only
 * remaining guard, so they belong here now.
 *
 * Each id is wrong in a distinct, expensive way: the order id is what
 * `/orders/{id}` polls (FUT-681), the charge id is the cross-system
 * idempotency key, and the vault token is what a later saved-card charge is
 * sent as.
 */

const CREDS = { environment: 'SANDBOX' as const, fields: { token: 'tok' } };

function mockFetch(response: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank snapshots — the three ids stay distinct', () => {
  it('maps a card response to order / charge / vault ids separately', async () => {
    mockFetch({
      id: 'ORDE_A',
      charges: [
        {
          id: 'CHAR_A',
          status: 'PAID',
          payment_response: { code: '20000' },
          payment_method: { card: { id: 'CARD_A', brand: 'visa', last_digits: '2097' } },
        },
      ],
    });

    const snapshot = await pagbankProvider().createCharge(cardInput(), CREDS);

    // Three ids from one payload, three destinations. Asserted together on
    // purpose: any pair being swapped is the failure this pins, and checking
    // them one at a time would let a swap pass twice.
    expect(snapshot.settlementHints?.orderId).toBe('ORDE_A');
    expect(snapshot.providerChargeId).toBe('CHAR_A');
    expect(snapshot.card?.vaultToken).toBe('CARD_A');
  });

  it('vaults the id PagBank RETURNED, never the one-time token that was sent', async () => {
    // The request carries a single-use encrypted blob; the response carries the
    // reusable id. Providers reject the blob on a second charge, so a mapping
    // that echoed the request would produce a saved card that always declines
    // — and only on the buyer's NEXT visit, long after this code ran.
    mockFetch({
      id: 'ORDE_B',
      charges: [
        {
          id: 'CHAR_B',
          status: 'PAID',
          payment_response: { code: '20000' },
          payment_method: { card: { id: 'CARD_REUSABLE' } },
        },
      ],
    });

    const snapshot = await pagbankProvider().createCharge(
      cardInput('order-2', 'tok_one_time_blob'),
      CREDS,
    );

    expect(snapshot.card?.vaultToken).toBe('CARD_REUSABLE');
    expect(snapshot.card?.vaultToken).not.toBe('tok_one_time_blob');
  });

  it('carries no vault token when PagBank stored nothing', async () => {
    // Absent, not empty-string: a host asks "did we get a token?" and a falsy
    // placeholder answers yes.
    mockFetch({
      id: 'ORDE_C',
      charges: [{ id: 'CHAR_C', status: 'PAID', payment_response: { code: '20000' } }],
    });

    const snapshot = await pagbankProvider().createCharge(cardInput(), CREDS);

    expect(snapshot.card?.vaultToken).toBeUndefined();
  });

  it('names the ORDER on an unpaid PIX, whose charge does not exist yet', async () => {
    // PagBank mints the charge only when the buyer pays, so at creation the
    // order id is the only provider-side identity there is. It rides in
    // `settlementHints.orderId` — labelled as an order id — so a later read can
    // re-key the row once a webhook finally names the real charge, instead of
    // the row being unfindable.
    mockFetch({
      id: 'ORDE_D',
      qr_codes: [{ text: '00020126-emv', expiration_date: '2030-01-01T00:00:00Z' }],
    });

    const snapshot = await pagbankProvider().createCharge(pixInput(), CREDS);

    expect(snapshot.settlementHints?.orderId).toBe('ORDE_D');
    expect(snapshot.providerChargeId).toBe('ORDE_D');
  });

  it('keeps the order to poll once a paid order names its real charge', async () => {
    // The read API is keyed by ORDER, so `settlementHints.orderId` must survive
    // even after `providerChargeId` stops being the order id — otherwise the
    // next poll has nothing to ask about.
    mockFetch({
      id: 'ORDE_E',
      charges: [{ id: 'CHAR_E', status: 'PAID', amount: { value: 1234 } }],
    });

    const snapshot = await pagbankProvider().getCharge('ORDE_E', CREDS);

    expect(snapshot.settlementHints?.orderId).toBe('ORDE_E');
    expect(snapshot.providerChargeId).toBe('CHAR_E');
  });
});
