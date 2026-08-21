/**
 * How long is left on a rate limit, said in a way somebody can act on.
 *
 * ## Why this is not "aguarde alguns minutos"
 *
 * A limit with no number is indistinguishable from a broken screen. Somebody
 * who is told to "wait a few minutes" retries at thirty seconds, gets the same
 * refusal, and concludes their account is locked — so they either give up or
 * contact support about something that was going to resolve itself. The wait is
 * KNOWN: the server that refused the request is the thing that knows when it
 * will stop refusing, and it says so.
 *
 * The rounding is deliberately generous — always UP, never down. A countdown
 * that says "1 minuto" and still refuses at 61 seconds is worse than one that
 * said "2 minutos" and let somebody back in early, because the first teaches
 * that the number is a lie.
 */

/** The words a host uses to say a remaining time. Plural forms are its own. */
export interface RateLimitCopy {
  /** e.g. `(n) => `${n} segundos`` */
  seconds: (count: number) => string;
  /** e.g. `(n) => `${n} minutos`` */
  minutes: (count: number) => string;
  /** Wraps the duration: `(left) => `Muitas tentativas. Tente de novo em ${left}.`` */
  retryIn: (remaining: string) => string;
  /** When the server refused without saying for how long. */
  retryUnknown: string;
}

/** One minute, in seconds — the threshold where the unit changes. */
const MINUTE = 60;

/**
 * Turn "retry after N seconds" into a sentence.
 *
 * `retryAfterSeconds` is what the server sent, so `undefined` and `0` are
 * genuinely different: the first means it refused without saying when, and the
 * screen must not invent a number for it.
 */
export function rateLimitMessage(
  retryAfterSeconds: number | undefined,
  copy: RateLimitCopy,
): string {
  if (retryAfterSeconds === undefined || !Number.isFinite(retryAfterSeconds)) {
    return copy.retryUnknown;
  }
  const remaining = Math.max(0, Math.ceil(retryAfterSeconds));
  if (remaining < MINUTE) return copy.retryIn(copy.seconds(remaining));
  return copy.retryIn(copy.minutes(Math.ceil(remaining / MINUTE)));
}
