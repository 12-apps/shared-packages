import { describe, expect, it } from 'vitest';

import type { RecordedHttpCall } from '../core/traffic-recorder';
import { reasonOfStatus } from '../platform/evidence/failure-reason';

/**
 * FUT-5512: a production evidence charge PagBank DECLINED is the ISSUER's
 * refusal unless its `payment_response.code` is PagBank's own antifraud
 * (`10000` "NAO AUTORIZADO PELO PAGSEGURO", the 10xxx block read as
 * `FRAUD_SUSPECTED`). On 2026-11-23 an Apple Pay charge answered 10000 and the
 * card told the operator the bank had refused it.
 */

function orderAnswer(code: string | number | undefined, reasonCode?: string): RecordedHttpCall {
  const payment_response = code === undefined ? undefined : { code, message: 'x', ...(reasonCode ? { raw_data: { reason_code: reasonCode } } : {}) };
  return {
    at: '2026-11-23T16:14:42.000Z',
    method: 'POST',
    url: 'https://api.pagseguro.com/orders',
    requestHeaders: {},
    status: 201,
    responseBody: { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'DECLINED', ...(payment_response ? { payment_response } : {}) }] },
  };
}

describe('reasonOfStatus (FUT-5512)', () => {
  it('reads PagBank antifraud 10000 as ANTIFRAUD_DECLINED', () => {
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer('10000')])).toBe('ANTIFRAUD_DECLINED');
  });

  it('accepts the code as a number too', () => {
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer(10000)])).toBe('ANTIFRAUD_DECLINED');
  });

  it('keeps an issuer decline ISSUER_DECLINED (20001, reason 05: the 2026-11-23 Nubank debit)', () => {
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer('20001', '05')])).toBe('ISSUER_DECLINED');
  });

  it("keeps the issuer's own fraud suspicion (20039) ISSUER_DECLINED: it is the bank, not PagBank", () => {
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer('20039')])).toBe('ISSUER_DECLINED');
  });

  it("keeps PagBank's other 10xxx refusals (10002, a generic issuer refusal) ISSUER_DECLINED", () => {
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer('10002')])).toBe('ISSUER_DECLINED');
  });

  it('answers ISSUER_DECLINED when no code was recorded, as before', () => {
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer(undefined)])).toBe('ISSUER_DECLINED');
    expect(reasonOfStatus('DECLINED', 'PAID')).toBe('ISSUER_DECLINED');
  });

  it('reads the last recorded answer that carries a charge', () => {
    const consulted = { ...orderAnswer('20001'), method: 'GET', url: 'https://api.pagseguro.com/orders/ORDE_1' };
    expect(reasonOfStatus('DECLINED', 'PAID', [orderAnswer('20001'), { ...consulted, responseBody: { error_messages: [] } }, orderAnswer('10000')])).toBe('ANTIFRAUD_DECLINED');
  });

  it('has no reason when the status was the expected one, or not a decline', () => {
    expect(reasonOfStatus('DECLINED', 'DECLINED', [orderAnswer('10000')])).toBeUndefined();
    expect(reasonOfStatus('PAID', 'PAID', [orderAnswer('10000')])).toBeUndefined();
  });
});
