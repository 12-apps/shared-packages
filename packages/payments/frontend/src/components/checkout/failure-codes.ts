/**
 * Checkout failure codes the BUYER SURFACE presents differently (FUT-563).
 *
 * Everything else the server refuses is one thing to a shopper — "it did not
 * work, try again" — and one danger Alert says it. These are the exceptions:
 * codes whose correct rendering is not an error at all, and which a message
 * string cannot be parsed for without turning copy edits into behaviour
 * changes.
 */

/**
 * The charge is IN DOUBT, not failed: some provider may be holding the buyer's
 * money and no probe could say. It is the one outcome where inviting a retry
 * is actively harmful, so the surface must drop every affordance that offers
 * one and must not word it as a failure.
 */
export const UNRESOLVED_CODE = "PAYMENT_UNRESOLVED";

/**
 * REFUSALS RE-SENDING THE SAME REQUEST CANNOT CLEAR (FUT-1182).
 *
 * A different exception from {@link UNRESOLVED_CODE}, and the difference is
 * worth keeping: an unresolved charge withholds the retry because pressing it
 * could take the buyer's money twice. These withhold it because pressing it
 * cannot do anything at all. The order was refused for a fact about the world —
 * the shop is shut, the mode is off, the booked slot is gone, the basket has
 * already been paid for, the merchant has connected no provider — and the
 * identical POST meets the identical fact. So the button was the screen's most
 * prominent control and it was guaranteed to fail, phrased as though the buyer
 * had got something wrong.
 *
 * ## Why a package names a host's vocabulary here
 *
 * Because the alternative is worse in both directions. A prop the host fills
 * would leave every host that has not filled it with the defect this exists to
 * remove; and a rule inferred from the STATUS code cannot separate these from
 * the 400s and 409s that a retry genuinely clears (`CHARGE_MISMATCH` is a 409
 * and re-raising is exactly what fixes it).
 *
 * What makes it safe is that the list is CLOSED and its members are wire
 * constants: this file already names `PAYMENT_UNRESOLVED` for the same reason,
 * and the transport beside it already speaks the routes those codes arrive on.
 * A host that answers none of these loses nothing — an unknown code keeps the
 * retry, which is the pre-1182 behaviour for every code.
 *
 * ## It never SUPPRESSES the message, only the button
 *
 * The host half of this ticket (FUT-1166) acts on the same codes: it refetches
 * whatever was stale, so the screen behind the refusal corrects itself into the
 * gate that says what the buyer can actually do. The refusal's own sentence has
 * to stay on screen while that happens, or a shopper watches a checkout
 * rearrange itself for no stated reason.
 *
 * ## What is deliberately NOT here
 *
 * `BASKET_NOT_FOUND` and `MODE_CATALOG_SCOPE`, because this list is the
 * GUARANTEED half. Both name states a fresh read can legitimately answer
 * differently, and withholding the retry on a maybe is how a buyer with a
 * recoverable problem ends up with no control at all — the same asymmetry
 * `CheckoutDecline.retriable` settles by treating silence as yes.
 */
const NO_RETRY_CODES: readonly string[] = [
  // The shop is shut, or shut by the time the slot came round.
  "STORE_CLOSED",
  "SCHEDULE_UNAVAILABLE",
  // The store does not sell this way — a bookmarked URL, or a mode cookie that
  // outlived the config allowing it.
  "MODE_UNAVAILABLE",
  // No provider connected. TWO spellings on purpose: the package's own routes
  // answer `PAYMENT_NOT_CONFIGURED`, and a host that guards its order route
  // before delegating answers its own. A client meets both.
  "PAYMENT_NOT_CONFIGURED",
  "PAYMENTS_NOT_CONFIGURED",
  // Already bought — in another tab, or by whoever was settling alongside them.
  // Retrying cannot un-pay it; the buyer wants their purchases, not this step.
  "CART_ALREADY_PAID",
  "BASKET_ALREADY_BOUGHT",
  // Nothing left to charge for, and this step cannot put anything back.
  "EMPTY_CART",
  "COMANDA_CLOSED",
  // The order cannot be delivered as asked. Fixed where the address is, which
  // is not here.
  "DELIVERY_UNAVAILABLE",
  "DELIVERY_ADDRESS_REQUIRED",
];

/**
 * Whether the surface may offer to send this refused order again.
 *
 * SILENCE MEANS YES, and so does anything unrecognised: a refusal with no code,
 * or one from a server this bundle is a release behind, keeps the retry. The
 * two packages version independently and a host may answer a vocabulary of its
 * own, so "never heard of it" has to degrade to the old behaviour rather than
 * to a screen with nothing on it.
 */
export function retryMayHelp(code: string | null | undefined): boolean {
  if (code === undefined || code === null) return true;
  return !NO_RETRY_CODES.includes(code);
}
