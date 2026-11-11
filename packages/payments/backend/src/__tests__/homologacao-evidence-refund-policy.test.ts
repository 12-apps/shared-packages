import { describe, expect, it } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import { REFUND_RETRY_ATTEMPTS, REFUND_RETRY_DELAYS_MS, refundRetryAt } from '../core/refund-retry';
import { classifyPagBankRefundRefusal } from '../providers/pagbank-rejections';

/**
 * PG1's reusable piece (FUT-4360, reused by FUT-4740's store refunds): the
 * package-level "refund not yet" classification and the backoff schedule.
 * Neither knows about the evidence: the evidence Pix retry and the store
 * refund retry read the same two.
 */

const pagbankError = (httpStatus: number, body: unknown): unknown =>
  new ProviderRequestError('pagbank', `PagBank ${httpStatus}`, { httpStatus, body });

describe('the refund retry policy (PG1, reused by FUT-4740)', () => {
  it('given the schedule, then it is 3 attempts with exponential pauses of 5 then 10 minutes', () => {
    expect(REFUND_RETRY_ATTEMPTS).toBe(3);
    expect(REFUND_RETRY_DELAYS_MS).toEqual([5 * 60_000, 10 * 60_000]);
  });

  it('given the attempts made so far, then the next is due 5 min after the 1st, 10 min after the 2nd, and never after the 3rd', () => {
    const last = new Date('2026-11-11T15:00:00.000Z');
    expect(refundRetryAt(1, last)?.toISOString()).toBe('2026-11-11T15:05:00.000Z');
    expect(refundRetryAt(2, last)?.toISOString()).toBe('2026-11-11T15:10:00.000Z');
    expect(refundRetryAt(3, last)).toBeNull();
  });

  it('given PagBank 40008, then the refusal reads NOT_YET from the structured code', () => {
    const error = pagbankError(400, { error_messages: [{ code: '40008', message: 'refund_temporarily_unavailable', description: 'Transaction is not found.' }] });
    expect(classifyPagBankRefundRefusal(error)).toBe('NOT_YET');
  });

  it('given a 40008 only in the message text, then it is NOT read as not-yet: codes, never regexes', () => {
    expect(classifyPagBankRefundRefusal(new Error('PagBank 400 Bad Request: {"code":"40008"}'))).toBe('UNKNOWN');
  });

  it('given any other 4xx, then REFUSED; a 5xx or a transport error, then UNKNOWN', () => {
    expect(classifyPagBankRefundRefusal(pagbankError(400, { error_messages: [{ code: '40002', parameter_name: 'amount.value' }] }))).toBe('REFUSED');
    expect(classifyPagBankRefundRefusal(pagbankError(503, { error_messages: [{ code: 'SERVICE_UNAVAILABLE' }] }))).toBe('UNKNOWN');
    expect(classifyPagBankRefundRefusal(new TypeError('fetch failed'))).toBe('UNKNOWN');
  });
});
