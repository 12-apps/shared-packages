import type { RefundRefusal } from './refund-retry';
import type { RefundRetrier } from './refund-series';
import type { RefundSeriesKey } from './refund-series-store';

/**
 * A BUYER asks for their capture back (FUT-612): "Cancelar e receber R$ X de
 * volta" on a payable that holds a short capture.
 *
 * No new provider code, and no second refund path: this is the store refund's
 * own retrier (FUT-4740) keyed to ONE charge, sent once from the buyer's act.
 * Attempt 1 goes now; a provider that says "not yet" — PagBank does for a few
 * seconds after a Pix capture — or does not answer opens the same background
 * series as a store refund, and a refusal for good leaves a pending refund for
 * the store to settle ("Estorno pendente"). What this adds is only the reading
 * a BUYER's screen needs of attempt 1: did the money go back, is it on its way,
 * or is it now the store's to finish.
 *
 * THE HOST still binds the retrier (its `stillOwed`, `attempted`, `refunded`
 * writes) and decides who may ask: the buyer's ownership of the payable, and
 * that the shortfall is still unresolved, are checked before this is called.
 * The refund is the WHOLE charge unless `amountCents` names a part.
 *
 * Throws what `firstAttempt` throws: a refusal decided before anything was sent
 * (no connection, no refund capability) is the host's to word.
 */

/** The subject a buyer-asked refund is kept under, beside a store refund's `order`. */
export const BUYER_REFUND_SUBJECT = 'buyer-request';

/** Which capture, of which payable, and what it was asked for. */
export interface CaptureRefundRequest extends Omit<RefundSeriesKey, 'subject'> {
  /** Defaults to {@link BUYER_REFUND_SUBJECT}. */
  subject?: string;
  /** Carried to the provider, where it takes one. */
  reason?: string;
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
  | { kind: 'PENDING'; refusal: RefundRefusal; retrying: boolean };

export async function refundCaptureOnRequest(
  retrier: Pick<RefundRetrier, 'firstAttempt'>,
  request: CaptureRefundRequest,
): Promise<CaptureRefundOutcome> {
  const { reason, subject, ...key } = request;
  const result = await retrier.firstAttempt(
    { ...key, subject: subject ?? BUYER_REFUND_SUBJECT },
    reason ? { reason } : undefined,
  );
  switch (result.kind) {
    case 'REFUNDED':
      if (result.snapshot.status === 'REFUNDED') {
        return { kind: 'REFUNDED', refundedCents: result.snapshot.amount.amountCents };
      }
      // A provider-side FAILED is a refusal it answered: the store's to finish.
      return result.snapshot.status === 'PENDING'
        ? { kind: 'ACCEPTED' }
        : { kind: 'PENDING', refusal: 'REFUSED', retrying: false };
    case 'ADOPTED':
      return { kind: 'REFUNDED', refundedCents: result.refundedCents };
    case 'REFUSED':
      return { kind: 'PENDING', refusal: 'REFUSED', retrying: false };
    default:
      return { kind: 'PENDING', refusal: result.kind, retrying: result.row !== null };
  }
}
