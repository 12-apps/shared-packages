import { describe, expect, it } from 'vitest';

import { PAGBANK_DECLINE_CODES, pagbankDecline } from '../providers/pagbank-declines';

/**
 * Every `payment_response.code` in the published table, transcribed from
 * reference/motivos-de-compra-negada on 2026-07-30 — the first column, in
 * order, minus `20000` (SUCESSO), which is an approval and never reaches a
 * decline map.
 *
 * The table's other axis is what FUT-475 was about: 33 codes over 72 rows,
 * because each code fans out to several issuer reasons. Those live in the
 * reason-code tests below; this list is only the code axis.
 */
const PUBLISHED_CODES = [
  '10000', '10001', '10002', '10003', '10004',
  '20001', '20003', '20007', '20008', '20012', '20017', '20018', '20019', '20039',
  '20101', '20102', '20103', '20104', '20105', '20110', '20111', '20112', '20113',
  '20114', '20115', '20116', '20117', '20118', '20119', '20158', '20159', '20301',
  '20999',
];

describe('the published code set', () => {
  /**
   * A divergence here is invisible in production — an unlisted code does not
   * throw, it silently becomes "declined, try again", losing both the reason a
   * tenant is shown and PagBank's own retriability verdict that the dunning
   * job branches on. So it has to fail in CI instead.
   */
  it('is implemented exactly — no gaps, nothing invented', () => {
    expect(Object.keys(PAGBANK_DECLINE_CODES).sort()).toEqual([...PUBLISHED_CODES].sort());
  });

  it('does not carry 20000, which is an approval', () => {
    expect(PAGBANK_DECLINE_CODES).not.toHaveProperty('20000');
  });

  /**
   * PagBank removed the accents from `payment_response.message`. Nothing here
   * may depend on that text — matching is on the numeric code alone, so an
   * accent change cannot silently stop a row from resolving.
   */
  it('matches on codes, never on the message text', () => {
    expect(pagbankDecline('20007', { reason_code: '54' }).reason).toBe('EXPIRED_CARD');
    expect(Object.values(PAGBANK_DECLINE_CODES).every((row) => Object.keys(row).length === 2)).toBe(
      true,
    );
  });
});

/**
 * The issuer-reason refinement (FUT-475).
 *
 * PagBank's table is two-dimensional — 33 `payment_response.code` values over
 * 72 published rows — and the code alone is the coarser axis. Reading only the
 * code told a tenant with an EXPIRED card to check the number, reported a
 * STOLEN card as a fault in our own system, and answered "suspected fraud" for
 * an account that had simply been closed.
 *
 * What is pinned here is the refinement AND its limits: it must never fire on
 * a reason code that means two things under the same PagBank code, and it must
 * leave `retriable` exactly as PagBank published it.
 */
describe('pagbankDecline', () => {
  it('reads the code alone when PagBank sends no raw_data', () => {
    expect(pagbankDecline('20007')).toEqual({ reason: 'INVALID_CARD', retriable: false });
    expect(pagbankDecline('20003', {})).toEqual({
      reason: 'INSUFFICIENT_FUNDS',
      retriable: true,
    });
  });

  /** The headline: 54 is CARTÃO VENCIDO, and it was being called a typo. */
  it.each([
    ['54', 'the ABECS/Mastercard/Visa/Elo code'],
    ['101', "Amex's code for the same thing"],
    ['79', 'CICLO DE VIDA — the issuer reissued the card'],
  ])('resolves 20007 + reason_code %s to EXPIRED_CARD (%s)', (reasonCode) => {
    expect(pagbankDecline('20007', { reason_code: reasonCode })).toEqual({
      reason: 'EXPIRED_CARD',
      retriable: false,
    });
  });

  it('still calls a mistyped number under 20007 an INVALID_CARD', () => {
    // 14 is NÚMERO CARTÃO INVÁLIDO — the reading the whole code used to get.
    expect(pagbankDecline('20007', { reason_code: '14' })).toEqual({
      reason: 'INVALID_CARD',
      retriable: false,
    });
  });

  it('tells a stolen card apart from an invalid merchant under 20017', () => {
    // Both arrive as "TRANSACAO NAO PERMITIDA", whose base mapping is
    // PROVIDER_ERROR — correct for the merchant, absurd for the card.
    expect(pagbankDecline('20017', { reason_code: '3' }).reason).toBe('PROVIDER_ERROR');
    expect(pagbankDecline('20017', { reason_code: '41' }).reason).toBe('INVALID_CARD');
    expect(pagbankDecline('20017', { reason_code: '43' }).reason).toBe('FRAUD_SUSPECTED');
    expect(pagbankDecline('20017', { reason_code: '83' }).reason).toBe('FRAUD_SUSPECTED');
  });

  it('does not accuse a closed account of fraud', () => {
    // 20039's base is FRAUD_SUSPECTED, which is right for 4/7 (FRAUDE
    // CONFIRMADA) and an accusation for 46 (CONTA ENCERRADA).
    expect(pagbankDecline('20039', { reason_code: '4' }).reason).toBe('FRAUD_SUSPECTED');
    expect(pagbankDecline('20039', { reason_code: '46' }).reason).toBe('INVALID_CARD');
  });

  it('matches the padded form PagBank actually sends', () => {
    // The table prints `3`; the payload example sends `"03"`. Both are the row.
    expect(pagbankDecline('20017', { reason_code: '043' }).reason).toBe('FRAUD_SUSPECTED');
    expect(pagbankDecline('20039', { reason_code: 'r2' }).reason).toBe('PROVIDER_ERROR');
  });

  /**
   * The safety rule. Reason codes are published PER NETWORK and the response
   * does not say which network answered, so a code meaning two things under
   * one PagBank code cannot be resolved — Elo's 57 under 20039 is three
   * different rows, and 58 under 20017 is two.
   */
  it.each([
    ['20039', '57'],
    ['20017', '58'],
    ['20007', '122'],
  ])('leaves the ambiguous pair %s/%s to the code alone', (code, reasonCode) => {
    expect(pagbankDecline(code, { reason_code: reasonCode })).toEqual(pagbankDecline(code));
  });

  it('never lets a sub-reason overrule PagBank on retriability', () => {
    // 20001 is retriable; naming its fraud row must not quietly stop the
    // billing job from trying again, and 20017's block stays terminal.
    expect(pagbankDecline('20001', { reason_code: '63' })).toEqual({
      reason: 'FRAUD_SUSPECTED',
      retriable: true,
    });
    expect(pagbankDecline('20017', { reason_code: '43' }).retriable).toBe(false);
  });

  it('ignores a reason code under a code that has no refinements', () => {
    expect(pagbankDecline('20019', { reason_code: '91' })).toEqual({
      reason: 'PROVIDER_ERROR',
      retriable: true,
    });
  });

  it('keeps an unknown code retriable even when raw_data is present', () => {
    expect(pagbankDecline('29999', { reason_code: '54' })).toEqual({
      reason: 'CARD_DECLINED',
      retriable: true,
    });
  });

  it('treats a missing payment_response as unrecognized', () => {
    expect(pagbankDecline(undefined)).toEqual({ reason: 'CARD_DECLINED', retriable: true });
  });
});
