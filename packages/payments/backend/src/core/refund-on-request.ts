import type { RefundRefusal } from './refund-retry';
import type { FirstAttemptResult, RefundRetrier } from './refund-series';
import type { RefundSeriesKey } from './refund-series-store';

/**
 * A SHORT CAPTURE GOES BACK (FUT-612): the buyer's "Cancelar e receber R$ X de
 * volta" (decision 2), the 24 h automatic refund (decision 5) and the store's
 * own pending-refund act all return the same money — the WHOLE capture that
 * arrived short. They are one refund, so they share:
 *
 *  - ONE CLAIM, the host's, taken before anything is sent: a double tap, two
 *    tabs, the sweep and a person meet the same claim, and only its holder
 *    sends. Released only when nothing is under way any more — a refusal for
 *    good, or a failure decided before anything was sent — so the next asker
 *    (the store's "Estorno pendente") can act.
 *  - ONE SUBJECT, {@link SHORT_CAPTURE_REFUND_SUBJECT}, so the background
 *    series a "not yet" opens is the same row whoever asked first.
 *  - THE WHOLE CHARGE. There is no amount here: a part is not what any of the
 *    three acts returns, and a part could be sent twice with nothing capping it
 *    at the capture.
 *
 * No new provider code: attempt 1 goes through the store refund's own retrier
 * (FUT-4740), and every later attempt is that retrier's. An attempt 1 the
 * provider answers with a FAILED refund opens the series and writes the trail
 * like any other refusal (`failedAnswer`), instead of leaving the buyer's money
 * with nobody retrying it.
 *
 * Throws what `firstAttempt` throws — a refusal decided before anything was
 * sent (no connection, no refund capability) — after giving the claim back.
 */

/** The ONE subject every refund of a short capture is kept under, whoever asks. */
export const SHORT_CAPTURE_REFUND_SUBJECT = 'short-capture';

/** Which capture, of which payable. The whole charge: there is no amount. */
export interface CaptureRefundRequest extends Omit<RefundSeriesKey, 'subject' | 'amountCents'> {
  /** Carried to the provider, where it takes one. */
  reason?: string;
}

/**
 * The host's claim on this capture's refund, keyed by the charge — the same one
 * the buyer's act, the 24 h sweep and the store's act take.
 */
export interface CaptureRefundClaim {
  /** Take the right to send this capture's refund; false when another asker holds it. */
  claim(): Promise<boolean>;
  /** Give it back: nothing is under way any more, and the next asker may act. */
  release(): Promise<void>;
}

/** What the buyer's screen can say once attempt 1 answered. */
export type CaptureRefundOutcome =
  /** The money went back (or already had: the charge had nothing left to refund). */
  | { kind: 'REFUNDED'; refundedCents: number | null }
  /** The provider took the refund and completes it on its own schedule. */
  | { kind: 'ACCEPTED' }
  /**
   * Not back yet. `retrying`: a background series will try again by itself;
   * otherwise it waits for the store ("Estorno pendente").
   */
  | { kind: 'PENDING'; refusal: RefundRefusal; retrying: boolean }
  /** Someone else holds the claim — an earlier tap, the sweep, the store: nothing was sent. */
  | { kind: 'ALREADY_ASKED' };

type Retrier = Pick<RefundRetrier, 'firstAttempt'> & Required<Pick<RefundRetrier, 'failedAnswer'>>;

export async function refundCaptureOnRequest(
  retrier: Retrier,
  claim: CaptureRefundClaim,
  request: CaptureRefundRequest,
): Promise<CaptureRefundOutcome> {
  if (!(await claim.claim())) return { kind: 'ALREADY_ASKED' };
  const { reason, ...rest } = request;
  const key: RefundSeriesKey = { ...rest, subject: SHORT_CAPTURE_REFUND_SUBJECT };
  let result: FirstAttemptResult;
  try {
    result = await retrier.firstAttempt(key, reason ? { reason } : undefined);
  } catch (error) {
    await claim.release();
    throw error;
  }
  if (result.kind === 'REFUNDED' && result.snapshot.status === 'FAILED') {
    result = await retrier.failedAnswer(key);
  }
  const outcome = outcomeOf(result);
  // A refusal for good leaves nothing under way: the store's act may now claim it.
  if (outcome.kind === 'PENDING' && !outcome.retrying) await claim.release();
  return outcome;
}

function outcomeOf(result: FirstAttemptResult): CaptureRefundOutcome {
  switch (result.kind) {
    case 'REFUNDED':
      return result.snapshot.status === 'REFUNDED'
        ? { kind: 'REFUNDED', refundedCents: result.snapshot.amount.amountCents }
        : { kind: 'ACCEPTED' };
    case 'ADOPTED':
      return { kind: 'REFUNDED', refundedCents: result.refundedCents };
    case 'REFUSED':
      return { kind: 'PENDING', refusal: 'REFUSED', retrying: false };
    default:
      return { kind: 'PENDING', refusal: result.kind, retrying: result.row !== null };
  }
}
