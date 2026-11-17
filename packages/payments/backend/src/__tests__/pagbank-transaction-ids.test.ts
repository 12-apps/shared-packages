import { describe, expect, it } from 'vitest';

import { mapCard, mapPix, orderSnapshot } from '../providers/pagbank-snapshots';

import { cardInput, pixInput } from './fixtures';

/**
 * The transaction identifiers a PagBank snapshot carries (FUT-2239).
 *
 * A fiscal document links the payment that paid it by the transaction's own
 * ids — the Pix end-to-end id, the card's NSU and authorisation code — and by
 * the PSP that processed it. The host must not dig those out of `raw`, so the
 * adapter normalizes them into `ChargeSnapshot.transaction`.
 *
 * The payloads below are PagBank's own published examples (the order object's
 * reference page: `charges[].paid_at`, `payment_method.pix.end_to_end_id`,
 * `payment_response.reference` "NSU da autorização"; the `raw_data` block is
 * the decline table's example, quoted in `pagbank-declines.ts`).
 */

const PAGBANK_CNPJ_BASE = '08561701';

const PAID_PIX_ORDER = {
  id: 'ORDE_F87334AC-BB8B-42E2-AA85-8579F70AA328',
  reference_id: 'order-1',
  charges: [
    {
      id: 'CHAR_F1F10115-09F4-4560-85F5-A828D9F96300',
      status: 'PAID',
      created_at: '2023-02-08T15:15:11.881-03:00',
      paid_at: '2023-02-08T15:15:12.000-03:00',
      amount: { value: 500, currency: 'BRL', summary: { total: 500, paid: 500, refunded: 0 } },
      payment_response: { code: '20000', message: 'SUCESSO' },
      payment_method: {
        type: 'PIX',
        pix: {
          end_to_end_id: 'ffab77a6818042e292e9bc1d0a51dbf2',
          holder: { name: 'José da Silva', tax_id: '***534218**' },
        },
      },
    },
  ],
};

const APPROVED_TRACE = {
  code: '20000',
  message: 'SUCESSO',
  reference: '032416400102',
  raw_data: { authorization_code: '145803', nsu: '032416400102', reason_code: '00' },
};

describe('orderSnapshot — a paid order names its transaction', () => {
  it('carries the Pix end-to-end id, the provider paid-at and PagBank as PSP', () => {
    const snapshot = orderSnapshot(PAID_PIX_ORDER, 'fallback');
    expect(snapshot.transaction).toEqual({
      endToEndId: 'ffab77a6818042e292e9bc1d0a51dbf2',
      settledAt: '2023-02-08T18:15:12.000Z',
      pspCnpjBase: PAGBANK_CNPJ_BASE,
    });
  });

  it('carries a paid card charge NSU and authorisation code', () => {
    const snapshot = orderSnapshot(
      {
        id: 'ORDE_C',
        charges: [
          {
            id: 'CHAR_C',
            status: 'PAID',
            paid_at: '2023-02-08T18:29:05.000-03:00',
            amount: { value: 1000 },
            payment_response: APPROVED_TRACE,
            payment_method: { type: 'CREDIT_CARD' },
          },
        ],
      },
      'fallback',
    );
    expect(snapshot.transaction).toEqual({
      nsu: '032416400102',
      authorizationCode: '145803',
      settledAt: '2023-02-08T21:29:05.000Z',
      pspCnpjBase: PAGBANK_CNPJ_BASE,
    });
  });

  it('falls back to payment_response.reference for the NSU when raw_data omits it', () => {
    const snapshot = orderSnapshot(
      {
        charges: [
          {
            id: 'CHAR_D',
            status: 'PAID',
            amount: { value: 1000 },
            payment_response: { code: '20000', reference: '021646094820' },
            payment_method: { type: 'DEBIT_CARD' },
          },
        ],
      },
      'fallback',
    );
    expect(snapshot.transaction).toEqual({ nsu: '021646094820', pspCnpjBase: PAGBANK_CNPJ_BASE });
  });

  it('names no trace for a declined card, whatever raw_data carries', () => {
    const snapshot = orderSnapshot(
      {
        charges: [
          {
            id: 'CHAR_X',
            status: 'DECLINED',
            payment_response: {
              code: '20017',
              reference: '021646094820',
              raw_data: { authorization_code: '022188', nsu: '021646094820', reason_code: '83' },
            },
            payment_method: { type: 'CREDIT_CARD' },
          },
        ],
      },
      'fallback',
    );
    expect(snapshot.transaction).toEqual({ pspCnpjBase: PAGBANK_CNPJ_BASE });
  });

  it('names only the PSP for an unpaid Pix order with no charge yet', () => {
    const snapshot = orderSnapshot({ id: 'ORDE_P', qr_codes: [{ expiration_date: '2999-01-01T00:00:00Z' }] }, 'ORDE_P');
    expect(snapshot.transaction).toEqual({ pspCnpjBase: PAGBANK_CNPJ_BASE });
  });

  it('drops a paid-at it cannot read rather than passing it on verbatim', () => {
    const order = structuredClone(PAID_PIX_ORDER);
    (order.charges[0] as { paid_at: unknown }).paid_at = 'not a date';
    expect(orderSnapshot(order, 'fallback').transaction).not.toHaveProperty('settledAt');
  });

  it('ignores ids of the wrong type', () => {
    const snapshot = orderSnapshot(
      {
        charges: [
          {
            id: 'CHAR_T',
            status: 'PAID',
            paid_at: 12345,
            amount: { value: 1 },
            payment_response: { reference: 42, raw_data: { nsu: 7, authorization_code: null } },
            payment_method: { type: 'PIX', pix: { end_to_end_id: 99 } },
          },
        ],
      } as never,
      'fallback',
    );
    expect(snapshot.transaction).toEqual({ pspCnpjBase: PAGBANK_CNPJ_BASE });
  });
});

describe('mapPix — a raised QR', () => {
  it('names PagBank as PSP and invents no txid from the QR text', () => {
    const snapshot = mapPix(
      {
        id: 'ORDE_Q',
        charges: [{ id: 'CHAR_Q', qr_code: { text: '00020101021226850014br.gov.bcb.pix2563qrpix.example/qr/v2/abc5204000053039865802BR6304ABCD' } }],
      },
      pixInput(),
      '2026-11-17T12:30:00Z',
    );
    expect(snapshot.transaction).toEqual({ pspCnpjBase: PAGBANK_CNPJ_BASE });
  });
});

describe('mapCard — a card charge answered at once', () => {
  it('fills the NSU and authorisation code of an approval, also on card.authorizationCode', () => {
    const snapshot = mapCard(
      {
        id: 'ORDE_K',
        charges: [
          {
            id: 'CHAR_K',
            status: 'PAID',
            paid_at: '2023-02-08T18:34:10.000-03:00',
            payment_response: APPROVED_TRACE,
            payment_method: { type: 'CREDIT_CARD', card: { id: 'CARD_K', brand: 'visa', last_digits: '1111' } },
          },
        ],
      },
      cardInput(),
    );
    expect(snapshot.transaction).toEqual({
      nsu: '032416400102',
      authorizationCode: '145803',
      settledAt: '2023-02-08T21:34:10.000Z',
      pspCnpjBase: PAGBANK_CNPJ_BASE,
    });
    expect(snapshot.card?.authorizationCode).toBe('145803');
  });

  it('carries the trace of a pre-authorisation too', () => {
    const snapshot = mapCard(
      { id: 'ORDE_A', charges: [{ id: 'CHAR_A', status: 'AUTHORIZED', payment_response: APPROVED_TRACE }] },
      cardInput(),
    );
    expect(snapshot.transaction).toMatchObject({ nsu: '032416400102', authorizationCode: '145803' });
  });

  it('names no trace for a decline', () => {
    const snapshot = mapCard(
      {
        id: 'ORDE_N',
        charges: [
          {
            id: 'CHAR_N',
            status: 'DECLINED',
            payment_response: {
              code: '20017',
              reference: '021646094820',
              raw_data: { authorization_code: '022188', nsu: '021646094820', reason_code: '83' } as never,
            },
          },
        ],
      },
      cardInput(),
    );
    expect(snapshot.transaction).toEqual({ pspCnpjBase: PAGBANK_CNPJ_BASE });
    expect(snapshot.card).not.toHaveProperty('authorizationCode');
  });
});
