/**
 * The refund retry schedule (FUT-4360), provider-free so the evidence Pix and
 * the store refunds (FUT-4740) read the same one.
 *
 * A refund a provider cannot take yet ("not yet", then a transport error, a
 * 5xx) is retried in the BACKGROUND, never inside the request that first met
 * the refusal: at most {@link REFUND_RETRY_ATTEMPTS} attempts, spaced with
 * exponential backoff (5 minutes, then 10). After the last one nothing runs by
 * itself: a person decides.
 */

/** What a provider's refusal of a refund means for the next attempt. */
export type RefundRefusal =
  /** The provider says "not yet": the same refund will be taken later. */
  | 'NOT_YET'
  /** The provider refused for good: waiting changes nothing. */
  | 'REFUSED'
  /** No verdict (a 5xx, a timeout, a transport error): the refund may even have happened. */
  | 'UNKNOWN';

/** Attempts per series, the first one included. */
export const REFUND_RETRY_ATTEMPTS = 3;

/** The pause before attempt n + 1 is `[n - 1]`: 5 minutes, then 10. */
export const REFUND_RETRY_DELAYS_MS: readonly number[] = [5 * 60_000, 10 * 60_000];

/**
 * When the next attempt is due, given how many were made and when the last one
 * was made; null once {@link REFUND_RETRY_ATTEMPTS} were made.
 */
export function refundRetryAt(attemptsMade: number, lastAttemptAt: Date): Date | null {
  if (attemptsMade < 1 || attemptsMade >= REFUND_RETRY_ATTEMPTS) return null;
  const pause = REFUND_RETRY_DELAYS_MS[attemptsMade - 1];
  return pause === undefined ? null : new Date(lastAttemptAt.getTime() + pause);
}

/**
 * The `providerCode` an adapter puts on the error it throws when the charge it
 * was asked to refund has nothing left to refund — already refunded, by an
 * earlier cancel whose answer was lost or by the owner in the provider's panel.
 * A caller that owns the refund adopts it as done instead of treating it as a
 * failure; read from the code, never from the message.
 */
export const NOTHING_TO_REFUND = 'NOTHING_TO_REFUND';
