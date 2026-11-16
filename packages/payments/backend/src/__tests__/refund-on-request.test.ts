import { describe, expect, it, vi } from 'vitest';

import { createRefundRetrier } from '../core/refund-series';
import type { FirstAttemptResult } from '../core/refund-series';
import type { RefundSeriesKey, RefundSeriesRow } from '../core/refund-series-store';
import type { RefundSnapshot } from '../core/types';
import { SHORT_CAPTURE_REFUND_SUBJECT, refundCaptureOnRequest, type CaptureRefundClaim } from '../core/refund-on-request';
import { createMemoryRefundRetryStore } from '../memory';

/**
 * A short capture goes back (FUT-612, decision 2): the buyer's act, the 24 h
 * sweep and the store share ONE claim and ONE subject, the refund is always the
 * WHOLE capture, and an attempt 1 the provider answers FAILED opens the retry
 * series and writes the trail.
 */

const KEY = {
  merchant: { kind: 'TENANT' as const, id: 'acme' },
  provider: 'pagbank',
  providerChargeId: 'CHAR_690',
  reference: 'ord_1',
  boundTo: 'short-1',
};
const WHOLE = { ...KEY, subject: SHORT_CAPTURE_REFUND_SUBJECT };

const refund = (status: RefundSnapshot['status']): RefundSnapshot => ({
  provider: 'pagbank',
  providerChargeId: 'CHAR_690',
  providerRefundId: 'RE_1',
  status,
  amount: { amountCents: 690, currency: 'BRL' },
});

/** The host's claim on the charge's refund: one holder at a time, as a row the host keys by charge. */
function hostClaim(): CaptureRefundClaim & { held: () => boolean } {
  const state = { held: false };
  return {
    claim: vi.fn(async () => {
      if (state.held) return false;
      state.held = true;
      return true;
    }),
    release: vi.fn(async () => {
      state.held = false;
    }),
    held: () => state.held,
  };
}

function retrier(first: FirstAttemptResult, failed?: FirstAttemptResult) {
  return {
    firstAttempt: vi.fn<(key: RefundSeriesKey, input?: { reason?: string }) => Promise<FirstAttemptResult>>(async () => first),
    failedAnswer: vi.fn(async () => failed ?? first),
  };
}

describe('refundCaptureOnRequest', () => {
  it('sends attempt 1 once, for the WHOLE charge, under the one short-capture subject', async () => {
    const r = retrier({ kind: 'REFUNDED', snapshot: refund('REFUNDED') });
    await refundCaptureOnRequest(r, hostClaim(), { ...KEY, reason: 'buyer asked' });
    expect(r.firstAttempt).toHaveBeenCalledWith(WHOLE, { reason: 'buyer asked' });
    // No amount reaches the key: a part is not what any asker returns.
    expect(Object.hasOwn(r.firstAttempt.mock.calls[0]?.[0] ?? {}, 'amountCents')).toBe(false);
  });

  it('sends ONE refund for a double tap: the second asker finds the claim held', async () => {
    const r = retrier({ kind: 'REFUNDED', snapshot: refund('REFUNDED') });
    const asker = hostClaim();
    const [first, second] = await Promise.all([
      refundCaptureOnRequest(r, asker, KEY),
      refundCaptureOnRequest(r, asker, KEY),
    ]);
    expect(r.firstAttempt).toHaveBeenCalledTimes(1);
    expect([first.kind, second.kind].sort()).toEqual(['ALREADY_ASKED', 'REFUNDED']);
  });

  it('sends nothing when the sweep or the store holds the claim', async () => {
    const r = retrier({ kind: 'REFUNDED', snapshot: refund('REFUNDED') });
    const asker = hostClaim();
    await asker.claim();
    expect(await refundCaptureOnRequest(r, asker, KEY)).toEqual({ kind: 'ALREADY_ASKED' });
    expect(r.firstAttempt).not.toHaveBeenCalled();
  });

  it.each<[string, FirstAttemptResult, unknown, boolean]>([
    ['a refund taken', { kind: 'REFUNDED', snapshot: refund('REFUNDED') }, { kind: 'REFUNDED', refundedCents: 690 }, true],
    ['a refund the provider is processing', { kind: 'REFUNDED', snapshot: refund('PENDING') }, { kind: 'ACCEPTED' }, true],
    ['a charge already refunded', { kind: 'ADOPTED', refundedCents: 690 }, { kind: 'REFUNDED', refundedCents: 690 }, true],
    ['a refusal for good', { kind: 'REFUSED', error: new Error('no') }, { kind: 'PENDING', refusal: 'REFUSED', retrying: false }, false],
    ['a "not yet" with a series open', { kind: 'NOT_YET', error: new Error('40008'), row: {} as RefundSeriesRow }, { kind: 'PENDING', refusal: 'NOT_YET', retrying: true }, true],
  ])('reads %s, and keeps the claim only while something is under way', async (_what, result, expected, keeps) => {
    const asker = hostClaim();
    expect(await refundCaptureOnRequest(retrier(result), asker, KEY)).toEqual(expected);
    expect(asker.held()).toBe(keeps);
  });

  it('gives the claim back and rethrows a refusal decided before sending', async () => {
    const asker = hostClaim();
    const r = { firstAttempt: vi.fn(async () => Promise.reject(new Error('not connected'))), failedAnswer: vi.fn() };
    const sent = refundCaptureOnRequest(r, asker, KEY);
    await expect(sent).rejects.toThrow('not connected');
    expect(asker.release).toHaveBeenCalledTimes(1);
  });
});

describe('an attempt 1 the provider answers FAILED (the real retrier)', () => {
  it('opens the retry series on the no-answer schedule and writes the trail', async () => {
    const store = createMemoryRefundRetryStore();
    const attempted = vi.fn(async () => undefined);
    const real = createRefundRetrier({
      gateway: {
        refund: vi.fn(async () => refund('FAILED')),
        refreshCharge: vi.fn(async () => ({ status: 'PAID' as const })),
      },
      store,
      host: { stillOwed: async () => true, attempted, refunded: vi.fn(async () => undefined) },
      now: () => new Date('2026-11-16T12:00:00.000Z'),
    });
    const holder = hostClaim();

    const outcome = await refundCaptureOnRequest(real as Parameters<typeof refundCaptureOnRequest>[0], holder, KEY);

    expect(outcome).toEqual({ kind: 'PENDING', refusal: 'UNKNOWN', retrying: true });
    const row = await store.find('pagbank', 'CHAR_690', SHORT_CAPTURE_REFUND_SUBJECT);
    expect(row?.nextAt).not.toBeNull();
    expect(row?.amountCents).toBeNull();
    expect(attempted).toHaveBeenCalledTimes(1);
    // The series owns the refund now: the claim stays held.
    expect(holder.release).not.toHaveBeenCalled();
  });
});
