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

/** Refusals about the card DATA the buyer typed — corrected in place (FUT-4401). */
const CARD_DATA_REASONS: readonly CheckoutDeclineReason[] = ["INVALID_CARD", "EXPIRED_CARD"];

/** The refusal is about the card's number, expiry or code — the CVV is flagged. */
export function isCardDataDecline(decline: CheckoutDecline | null | undefined): boolean {
  return decline?.reason !== undefined && CARD_DATA_REASONS.includes(decline.reason);
}

/**
 * Whether the order a refused card was charged against is still chargeable
 * (FUT-4401) — a MIRROR of `@12-apps/payments-backend`'s
 * `declineLeavesPayableOpen`, which the server applies when it books the
 * refusal: the same card may be retried (`retriable: true`), or the refusal is
 * about card data the buyer corrects. `retriable` means "the same instrument"
 * and nothing else, so `false` on a mistyped CVV does not close the order.
 *
 * Anything else closed it server-side, so the buyer's next attempt must go on
 * a fresh order: charging the closed one answers its own status and nothing
 * more.
 */
export function declineKeepsOrder(decline: CheckoutDecline | null | undefined): boolean {
  return decline?.retriable === true || isCardDataDecline(decline);
}

/**
 * The same card may not be presented again, and its data is not the problem
 * (FUT-4401, FUT-1145): fraud suspected, attempts exhausted, a provider error
 * the acquirer calls final. Nothing typed again can change that answer, so the
 * checkout leaves that instrument unready — the next attempt needs another card
 * or another way to pay.
 */
export function declineBarsCard(decline: CheckoutDecline | null | undefined): boolean {
  return decline?.retriable === false && !isCardDataDecline(decline);
}
