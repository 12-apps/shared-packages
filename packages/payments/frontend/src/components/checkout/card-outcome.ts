import type { CheckoutDecline } from "./decline";
import { rememberHostedOrder } from "./hosted-return";
import type { CheckoutNavigate } from "./navigate-context";
import type { ChargeOutcome, CheckoutOrder, OnCheckoutResolved } from "./types";

/**
 * WHAT HAPPENS TO A CHARGE'S ANSWER — the two endings a card submit can have
 * that are not "keep polling".
 *
 * Split out of `./use-card-checkout.ts`, which is at its size ceiling. Both
 * halves are about the same moment: the provider has answered, and the buyer
 * is either being sent somewhere or being told something.
 */

/**
 * Hand the buyer to the provider's authentication page (FUT-698) — Stripe's
 * redirect-based 3-D Secure. Park the order and navigate, the same trip a
 * redirect provider's link takes (FUT-556): the return lands back on this
 * checkout route, where the hosted-resume machinery polls the parked order.
 */
export function handOverToChallenge(
  order: CheckoutOrder,
  url: string,
  navigate: CheckoutNavigate,
): void {
  // PARK FIRST. The navigation may not come back to a live SPA at all, and a
  // return trip that finds nothing parked lands the buyer on a blank
  // confirmation after they have paid.
  rememberHostedOrder(order, { handoff: true });
  navigate(url);
}

/**
 * The refusal a charge answer carries, or nothing (FUT-1145).
 *
 * `undefined` for an outcome with neither field — an older server, a provider
 * whose adapter classifies nothing — so the caller makes the same one-argument
 * call it always did and every screen below behaves exactly as before.
 */
function declineOf(outcome: ChargeOutcome): CheckoutDecline | undefined {
  const reason = outcome.declineReason;
  const retriable = outcome.retriable;
  if (reason === undefined && retriable === undefined) return undefined;
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(retriable === undefined ? {} : { retriable }),
  };
}

/**
 * Bubble a terminal status up, carrying the refusal when there is one.
 *
 * Called with ONE argument when the server said nothing new, so a host on an
 * older mount produces exactly the call it always did.
 */
export function reportResolved(outcome: ChargeOutcome, onResolved: OnCheckoutResolved): void {
  const refusal = declineOf(outcome);
  if (refusal) onResolved(outcome.status, refusal);
  else onResolved(outcome.status);
}
