import type { CheckoutOrder } from "./types";

/**
 * Surviving the trip to a hosted checkout (FUT-556).
 *
 * A redirect provider takes the buyer to ITS OWN site, so the SPA is torn down
 * and remounts fresh when they come back. Everything the checkout held —
 * which order was raised, for how much — is gone, and without it the return
 * lands on an empty payment step: no confirmation, no total, no sign that the
 * money they just moved arrived.
 *
 * The webhook still settles the order server-side; that is the mechanism and it
 * does not depend on any of this. What is rescued here is only the buyer's view
 * of it.
 *
 * `sessionStorage`, not `localStorage`: the handover is one tab's round trip,
 * and a pending order left in durable storage would resurface in a later,
 * unrelated session.
 */

/**
 * Where the parked order lives, namespaced to this PACKAGE.
 *
 * It used to carry one adopter's brand as its namespace, written into every
 * adopter's browser. A storage key is not a private detail: it is observable
 * surface, asserted on by `@12-apps/payments-e2e` and visible in devtools to
 * anyone running the host. The sibling handover in this same folder already got
 * this right with a `payments:` prefix; this one did not.
 *
 * Exported so a host or a spec names it rather than retyping it.
 */
export const HOSTED_ORDER_STORAGE_KEY = "payments.checkout.hostedOrder";

/**
 * The key before the rename, READ ONLY.
 *
 * A buyer who left for the provider's page on the old bundle comes back to the
 * new one with their order parked under the old name. Without this they land on
 * the plain return screen — the order still settles, because the webhook does
 * that and never depended on any of this, but the confirmation they were
 * promised is missing for a reason they could not possibly understand.
 *
 * Delete once no session can still be mid-redirect across that deploy.
 */
const LEGACY_KEY = "futurepay.checkout.hostedOrder";

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

/** Park the raised order before handing the buyer to the provider's page. */
export function rememberHostedOrder(order: CheckoutOrder): void {
  try {
    window.sessionStorage?.setItem(HOSTED_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage disabled or full. The redirect must still happen: the webhook
    // settles the order either way, and refusing to send the buyer to pay
    // would be a far worse failure than a plain return screen.
  }
}

/**
 * The parked order, but ONLY on a return trip — and cleared as it is read.
 *
 * Gated on the URL rather than on mere presence so a buyer who abandons the
 * provider's page and later opens checkout again starts a fresh order instead
 * of resuming one they never paid. Read-and-clear for the same reason: the
 * resumed view belongs to exactly one return.
 */
/**
 * The raw parked payload under either key, cleared as it is read.
 *
 * Split out from {@link takeHostedOrder} so the storage handling and the
 * parsing stay separately readable — reading two keys and clearing both put the
 * combined function over the complexity gate, and the two halves fail for
 * unrelated reasons anyway (storage disabled vs. a value that is not an order).
 *
 * BOTH keys are cleared whichever one answered: this is read-and-clear, and a
 * legacy entry left behind would let a later return trip resume an order that
 * was already consumed.
 */
function takeParkedPayload(): string | null {
  try {
    const raw =
      window.sessionStorage?.getItem(HOSTED_ORDER_STORAGE_KEY) ??
      window.sessionStorage?.getItem(LEGACY_KEY) ??
      null;
    window.sessionStorage?.removeItem(HOSTED_ORDER_STORAGE_KEY);
    window.sessionStorage?.removeItem(LEGACY_KEY);
    return raw;
  } catch {
    // Storage disabled or unavailable — the same "no parked order" as an empty
    // slot, and the webhook still settles the order regardless.
    return null;
  }
}

export function takeHostedOrder(): CheckoutOrder | null {
  if (!isReturnTrip()) return null;
  const raw = takeParkedPayload();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCheckoutOrder(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Trust nothing that came back out of storage: it is the only input here that
 * did not come from this render, and a half-written or hand-edited value would
 * otherwise reach the status view as an order.
 */
function isCheckoutOrder(value: unknown): value is CheckoutOrder {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CheckoutOrder>;
  return typeof candidate.orderId === "string" && typeof candidate.totalLabel === "string";
}
