/**
 * HOW A REFUSED CARD IS DESCRIBED (FUT-1145).
 *
 * Its own module rather than another block in `./types.ts`, which is at its
 * size ceiling — and because this is one idea with two halves that must travel
 * together: what happened, and whether trying again could ever work.
 */

/**
 * WHY a card was refused, in the cross-provider vocabulary the server
 * normalizes every acquirer's own code into (FUT-1145).
 *
 * A MIRROR of `@12-apps/payments-backend`'s `DeclineReason`, restated rather
 * than imported for the reason every other mirror in `./types.ts` is: the two
 * packages version independently, so a server one release ahead can answer a
 * reason this bundle has never heard of. Everything that reads it degrades to
 * the generic refusal rather than rendering nothing — see
 * `PaymentStatusCopy.declined`. `declines.test.ts` pins the mirror against the
 * backend union, so a reason ADDED there fails a test here rather than going
 * quietly unworded.
 */
export type CheckoutDeclineReason =
  | "INSUFFICIENT_FUNDS"
  | "CARD_DECLINED"
  | "INVALID_CARD"
  | "EXPIRED_CARD"
  | "FRAUD_SUSPECTED"
  | "PROVIDER_ERROR"
  | "UNKNOWN";

/**
 * A refusal as the checkout has to present it (FUT-1145): what happened, and
 * whether another attempt could ever work.
 *
 * The two answer different questions and neither can carry the other. "Attempts
 * exhausted — do not retry" and "the standing authorization was cancelled at
 * the bank" are both terminal for completely different causes, and a
 * seven-value taxonomy has to flatten one of them into a lie; meanwhile a
 * screen deciding whether to OFFER a retry needs the verdict and not the cause.
 *
 * `retriable` UNDEFINED means the provider offered no guidance, which is not
 * the same as "no": the retry stays on offer, because withholding it on
 * silence would strand a buyer whose card is fine.
 */
export interface CheckoutDecline {
  reason?: CheckoutDeclineReason;
  retriable?: boolean;
}
