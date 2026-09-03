import type { CheckoutBasketIdentity } from "./basket";
import {
  belongsHere,
  forgetHostedOrder,
  isStale,
  readParked,
  type ParkedHostedOrder,
} from "./hosted-store";
import type { CheckoutOrder } from "./types";

/**
 * WHETHER A PARKED CHECKOUT MAY BE RESUMED (FUT-556, FUT-1213).
 *
 * The storage half is `./hosted-store.ts`. What is decided here is the money
 * rule on top of it, and the rule exists because the first version had none:
 * a parked entry was resumed by whatever checkout mounted next, unconditionally.
 *
 * ## What that cost
 *
 * A shopper goes to the provider's page, does NOT pay, and comes back to the
 * store by a route that is not the checkout — typing the store's address, a
 * bookmark, history. They empty the basket, add a different product, and press
 * "pay". The checkout opened on the CONFIRMATION step, polling the old order
 * for fifteen minutes, with no amount and no reference and nothing on screen
 * to say which order it was about — and then told a shopper who never paid
 * "não pague de novo", while their live basket sat behind it. In stub mode it
 * was worse: the old order self-confirmed and the host's paid-order handler
 * closed the cart the old order pointed at, which by then held the NEW lines.
 *
 * ## The rule (product decision, 2026-09-02)
 *
 * "Bind the parked hand-off to the basket, and never lose a paid buyer's
 * confirmation." Given the parked entry and the basket now in front of the
 * checkout:
 *
 *  1. nothing parked, another store's entry, or a stale one → nothing changes;
 *  2. the basket is THE SAME as the one the order was raised from, **or it is
 *     empty** — the server closes a paid cart, so an empty basket is the paid
 *     buyer's normal state → resume;
 *  3. the basket is DIFFERENT → ask the server ONCE what the parked order is
 *     worth before deciding. PAID resumes and shows the confirmation; anything
 *     else drops the entry and opens a normal checkout for the basket in front
 *     of the shopper.
 *
 * Step 3 is what keeps the confirmation, and it is answerable where the
 * provider is not: a paid order is settled into the order row by the webhook,
 * so `GET /status` answers PAID from the database even though InfinitePay's own
 * `payment_check` cannot be asked without the `transaction_nsu` that only the
 * paid redirect carries.
 *
 * The decision is DEFERRED until the host's cart has loaded — see
 * {@link CheckoutBasketIdentity.ready}. Deciding against an unseeded cart reads
 * every basket as empty, which is rule 2, which is the old behaviour with extra
 * steps.
 */

/**
 * What a hosted provider appends to the return URL. InfinitePay sends the
 * first three; Stripe's redirect-based 3-D Secure appends `payment_intent`
 * (+ its client secret) and `redirect_status` to the `return_url` (FUT-698).
 * Any one alone is enough to recognise a return trip, which is why this is
 * a "some of", not an "all of" — a provider that sends only its own reference
 * must still be recognised rather than dropping the buyer on a blank page.
 */
const RETURN_MARKERS = [
  "transaction_nsu",
  "slug",
  "order_nsu",
  "payment_intent",
  "redirect_status",
] as const;

/** Whether the current URL looks like a buyer coming back from a hosted page. */
function isReturnTrip(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return RETURN_MARKERS.some((marker) => params.has(marker));
}

/**
 * Whether a payment raised in THIS tab is still waiting to be resolved.
 *
 * Exported because a host needs it and was otherwise forced to reimplement it.
 * `/menu/checkout` is a URL like any other, so a host may put a gate in front
 * of it — a closed-shop curtain, a plan check — and every such gate has to
 * stand aside for a buyer coming back from a payment, because that route is
 * where the money is confirmed. Deciding that from the outside meant copying
 * this module's marker list and its storage key into the host, which is
 * precisely the drift this package exists to stop: the copy went stale the
 * moment Stripe's 3-D Secure markers were added here.
 *
 * ## It asks the SAME question the resume asks (FUT-1213)
 *
 * A gate that stands aside for a return that is not going to happen is a gate
 * that has been talked out of its job — and at a SHUT store that is the whole
 * screen. FUT-1213 names it as one of the bug's own harms: the stale entry made
 * the closed-store curtain stand aside, so an abandoned shopper met
 * "Confirmando seu pagamento" where they should have met "Loja fechada".
 *
 * So this mirrors {@link takeHostedOrder}'s rule rather than merely asking
 * whether anything is parked: the entry must be THIS store's, not stale, and
 * still ABOUT the basket in front of the shopper — the same basket it was
 * raised from, or an empty one, which is the paid buyer's normal state because
 * the server closes a paid cart. Both directions fall out of it: a buyer who
 * paid reaches their confirmation at a shut store, and a buyer who abandoned
 * and rebuilt a different basket meets the curtain.
 *
 * It stays LOCAL and NON-CONSUMING, which is what makes it usable from a gate:
 * the comparison is against the parked signature, so there is no `/status`
 * round trip, and only the flow may take the order.
 *
 * **A host that passes no basket keeps the WIDE answer** — anything parked for
 * this store stands the gate aside. That is the pre-1213 behaviour, kept so an
 * un-migrated host is not broken by a bump, and it is the reason a host wiring
 * `cart.identity` must pass it here too: the gate and the flow behind it are
 * one decision, and only a host can hand both the same basket.
 *
 * A cart that has not LOADED answers `true` for the same reason it answers
 * `WAIT` on the resume: nothing is known yet, and the permissive answer is the
 * one that cannot strand a payer. A host that freezes this answer at mount
 * (`useState(() => …)`) must therefore not freeze it before its cart is ready.
 */
export function hostedCheckoutReturnPending(
  tenantSlug?: string,
  basket?: CheckoutBasketIdentity,
): boolean {
  const parked = readParked();
  // THE PARKED ENTRY DECIDES whenever there is one — the same questions the
  // resume asks, so a gate and the flow behind it cannot disagree about whose
  // return this is.
  //
  // Asking the URL FIRST is what this used to do, and it made the two disagree
  // exactly where it costs something: a provider marker is per-TAB, so store
  // A's abandoned hand-off plus any marked URL had the gate answer "a return is
  // pending here" on store B while `takeHostedOrder` correctly refused to
  // resume it.
  if (parked) {
    if (!belongsHere(parked, tenantSlug) || isStale(parked)) return false;
    return aboutThisBasket(parked, basket);
  }
  // Nothing parked, so the provider's own marker is the only evidence left that
  // a return is in progress. It is kept, and only here, for the case that has
  // no other signal: the flow has already CONSUMED the entry, and a gate
  // re-asking mid-visit must not curtain the confirmation it just let through.
  return isReturnTrip();
}

/**
 * Where a resumed checkout opens.
 *
 * `status` is the confirmation screen with its poll; `payment` puts the buyer
 * back in front of the code they were paying.
 */
export type HostedResumeStep = "status" | "payment";

/**
 * What the rule decided, and what the caller must do about it.
 *
 * `ASK` is the only verdict that leaves the entry PARKED: the caller has not
 * got its answer yet, and dropping the entry before the server has spoken would
 * lose a paid buyer's confirmation to a failed request. The caller consumes it
 * with `forgetHostedOrder` once it knows.
 */
export type HostedResumeDecision =
  | { verdict: "WAIT" }
  | { verdict: "NONE" }
  | { verdict: "RESUME"; order: CheckoutOrder; step: HostedResumeStep }
  | { verdict: "ASK"; order: CheckoutOrder };

/**
 * Where a resume lands, once one is happening.
 *
 * A HAND-OFF always lands on the confirmation: the buyer paid (or did not) on
 * another site, there is nothing on our page for them to do, and the only way
 * to learn which it was is to ask. Anything else — a PIX code, a card charge
 * raised on our own page — lands back on the PAYMENT step, because the thing
 * the buyer needs is still there and still valid: the server reuses the same
 * charge and the same code, so nothing is charged twice and the pane's own poll
 * still carries them to the confirmation the moment it settles.
 *
 * Unless the basket is EMPTY, which on this path means the server closed the
 * cart because the order was paid. Showing that shopper a QR to scan would be
 * showing them a code for money they have already sent.
 */
function resumeStepFor(
  parked: ParkedHostedOrder,
  basket: CheckoutBasketIdentity | undefined,
): HostedResumeStep {
  if (parked.handoff) return "status";
  return basket?.signature === null ? "status" : "payment";
}

/**
 * The parked order and what to do with it — the rule at the top of this file.
 *
 * Read-and-clear except on `ASK`. The resume happens once per parked checkout,
 * so leaving and reopening the checkout gives a fresh one; what changed in
 * FUT-1213 is only WHICH of those reads is allowed to resume.
 */
export function takeHostedOrder(
  tenantSlug?: string,
  basket?: CheckoutBasketIdentity,
): HostedResumeDecision {
  // Nothing is consumed against a cart that has not loaded: an unseeded cart
  // reads as empty, and empty is the verdict that resumes unconditionally.
  if (basket && !basket.ready) return { verdict: "WAIT" };
  const parked = readParked();
  if (!parked) return { verdict: "NONE" };
  // A checkout from ANOTHER store is left where it is rather than consumed: it
  // is that store's to resume, and this buyer may well go back to it.
  if (!belongsHere(parked, tenantSlug)) return { verdict: "NONE" };
  if (isStale(parked)) {
    forgetHostedOrder();
    return { verdict: "NONE" };
  }
  if (!aboutThisBasket(parked, basket)) return { verdict: "ASK", order: parked.order };
  forgetHostedOrder();
  return { verdict: "RESUME", order: parked.order, step: resumeStepFor(parked, basket) };
}

/**
 * Whether a parked entry is still ABOUT the basket in front of the shopper.
 *
 * THE ONE COMPARISON, used by both the resume and the gate above it, so the
 * two cannot answer differently about the same shopper — which is the property
 * the slug and staleness checks already had and this one has to have for the
 * same reason: a gate that stands aside for a resume that will not happen is
 * worse than either behaviour on its own.
 *
 * Three answers are `true`, and each is a different "nothing here says
 * otherwise":
 *
 *  - the host named no basket (an un-migrated host) — nothing to compare with;
 *  - the entry recorded none (an older bundle parked it) — nothing to compare;
 *  - the cart has not LOADED — nothing to compare YET, and the permissive
 *    answer is the one that cannot strand a payer. The resume's own `WAIT`
 *    verdict is the same choice made where a caller can act on it.
 *
 * And then the real comparison: the SAME basket, or an EMPTY one — the server
 * closes a paid cart inside the confirmation transaction, so an empty basket is
 * what a buyer who paid comes back to.
 */
function aboutThisBasket(
  parked: ParkedHostedOrder,
  basket: CheckoutBasketIdentity | undefined,
): boolean {
  if (!basket || parked.basket === undefined || !basket.ready) return true;
  return basket.signature === null || basket.signature === parked.basket;
}

export { HOSTED_ORDER_STORAGE_KEY, forgetHostedOrder, rememberHostedOrder } from "./hosted-store";
