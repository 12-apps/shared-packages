import { describe, expect, it, vi } from 'vitest';

import { BUYER_REFUND_SUBJECT, refundCaptureOnRequest } from '../core/refund-on-request';
import type { FirstAttemptResult, RefundRetrier } from '../core/refund-series';
import type { RefundSeriesRow } from '../core/refund-series-store';
import type { RefundSnapshot } from '../core/types';

/**
 * "Cancelar e receber R$ X de volta" (FUT-612, decision 2): the buyer's act
 * goes through the store refund's own retrier, keyed to ONE charge, and the
 * screen reads attempt 1 as back / on its way / the store's to finish.
 */

const KEY = {
  merchant: { kind: 'TENANT' as const, id: 'acme' },
  provider: 'pagbank',
  providerChargeId: 'CHAR_690',
  reference: 'ord_1',
  boundTo: 'short-1',
};

function retrier(result: FirstAttemptResult): Pick<RefundRetrier, 'firstAttempt'> & { firstAttempt: ReturnType<typeof vi.fn> } {
  return { firstAttempt: vi.fn(async () => result) };
}

const refund = (status: RefundSnapshot['status']): RefundSnapshot => ({
  provider: 'pagbank',
  providerChargeId: 'CHAR_690',
  providerRefundId: 'RE_1',
  status,
  amount: { amountCents: 690, currency: 'BRL' },
});

describe('refundCaptureOnRequest', () => {
  it('sends attempt 1 under the buyer subject, for the whole charge', async () => {
    const r = retrier({ kind: 'REFUNDED', snapshot: refund('REFUNDED') });
    await refundCaptureOnRequest(r, { ...KEY, reason: 'buyer asked' });
    expect(r.firstAttempt).toHaveBeenCalledWith({ ...KEY, subject: BUYER_REFUND_SUBJECT }, { reason: 'buyer asked' });
  });

  it('keeps a host subject', async () => {
    const r = retrier({ kind: 'REFUNDED', snapshot: refund('REFUNDED') });
    await refundCaptureOnRequest(r, { ...KEY, subject: 'short-payment' });
    expect(r.firstAttempt).toHaveBeenCalledWith({ ...KEY, subject: 'short-payment' }, undefined);
  });

  it.each<[string, FirstAttemptResult, unknown]>([
    ['a refund taken', { kind: 'REFUNDED', snapshot: refund('REFUNDED') }, { kind: 'REFUNDED', refundedCents: 690 }],
    ['a refund the provider is processing', { kind: 'REFUNDED', snapshot: refund('PENDING') }, { kind: 'ACCEPTED' }],
    ['a refund the provider answered FAILED', { kind: 'REFUNDED', snapshot: refund('FAILED') }, { kind: 'PENDING', refusal: 'REFUSED', retrying: false }],
    ['a charge already refunded', { kind: 'ADOPTED', refundedCents: 690 }, { kind: 'REFUNDED', refundedCents: 690 }],
    ['a refusal for good', { kind: 'REFUSED', error: new Error('no') }, { kind: 'PENDING', refusal: 'REFUSED', retrying: false }],
    ['a "not yet" with a series open', { kind: 'NOT_YET', error: new Error('40008'), row: {} as RefundSeriesRow }, { kind: 'PENDING', refusal: 'NOT_YET', retrying: true }],
    ['no answer and no series', { kind: 'UNKNOWN', error: new Error('timeout'), row: null }, { kind: 'PENDING', refusal: 'UNKNOWN', retrying: false }],
  ])('reads %s', async (_what, result, expected) => {
    expect(await refundCaptureOnRequest(retrier(result), KEY)).toEqual(expected);
  });

  it('lets a refusal decided before sending reach the host', async () => {
    const r = { firstAttempt: vi.fn(async () => Promise.reject(new Error('not connected'))) };
    await expect(refundCaptureOnRequest(r, KEY)).rejects.toThrow('not connected');
  });
});
