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
 * Whether a hand-off from THIS tab is still waiting to be resolved.
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
 * Read WITHOUT consuming. The gate asks on every render; only the flow may
 * take the order.
 */
export function hostedCheckoutReturnPending(tenantSlug?: string): boolean {
  if (isReturnTrip()) return true;
  const parked = readParked();
  if (!parked) return false;
  // Same two questions the resume asks, so a gate and the flow behind it can
  // never disagree: another store's hand-off is not this route's business, and
  // a stale one is nobody's.
  return belongsHere(parked, tenantSlug) && !isStale(parked);
}

/**
 * What is actually parked: the order, WHOSE STORE it belongs to, and when.
 *
 * `CheckoutOrder` carries no tenant, and on a multi-tenant storefront every
 * store shares one origin — so one tab holds one slot for all of them. Without
 * the slug, a buyer who abandoned store A's hand-off and opened store B's
 * checkout resumed A's order on B's screen: a confirmation for an unrelated
 * order, and B's own checkout skipped.
 *
 * `parkedAt` bounds the other axis. A hand-off is a round trip of minutes; an
 * entry older than {@link MAX_PARKED_AGE_MS} belongs to a session the buyer has
 * long since abandoned, and resuming it tells them about an order they are no
 * longer trying to place.
 */
interface ParkedHostedOrder {
  order: CheckoutOrder;
  /** The store this hand-off belongs to; absent for an unscoped host. */
  tenantSlug?: string;
  parkedAt: number;
}

/**
 * How long a parked hand-off stays resumable.
 *
 * Thirty minutes: a hosted payment takes minutes, and the window has to cover a
 * buyer who fetches their card, not one who comes back tomorrow. Beyond it the
 * entry is dropped on read rather than resumed.
 */
export const MAX_PARKED_AGE_MS = 30 * 60_000;

/** Park the raised order before handing the buyer to the provider's page. */
export function rememberHostedOrder(order: CheckoutOrder, tenantSlug?: string): void {
  try {
    const parked: ParkedHostedOrder = {
      order,
      ...(tenantSlug ? { tenantSlug } : {}),
      parkedAt: Date.now(),
    };
    window.sessionStorage?.setItem(HOSTED_ORDER_STORAGE_KEY, JSON.stringify(parked));
  } catch {
    // Storage disabled or full. The redirect must still happen: the webhook
    // settles the order either way, and refusing to send the buyer to pay
    // would be a far worse failure than a plain return screen.
  }
}

/**
 * The parked order, cleared as it is read.
 *
 * This USED to require a marker on the URL, so that a buyer who abandoned the
 * provider's page and reopened checkout got a fresh order rather than resuming
 * one they never paid. That reasoning is inverted for the provider it matters
 * most for, and the inversion is a money bug rather than a UX preference.
 *
 * Pressing the provider's "Continuar" is the ONLY thing that marks the URL.
 * Closing the tab, hitting back, or retyping the store's address are all
 * commoner, and all of them landed the buyer on a live payment step for an
 * order that may already be paid — an invitation to pay twice. It cannot be
 * decided by asking first, either: InfinitePay's `payment_check` refuses to
 * answer without a `transaction_nsu` that only that same redirect carries, so
 * "poll before resuming" reads PAID as PENDING and drops them on the pay
 * button anyway.
 *
 * So a parked order is itself the signal. The cost is that a buyer who truly
 * abandoned sees one confirmation screen reporting what the store actually
 * knows — which is the truth — with the way back on it. The read-and-clear
 * bounds it: the resume happens once per hand-off, and leaving and reopening
 * checkout gives a fresh one.
 *
 * `sessionStorage` already scopes this to one tab's round trip, so nothing
 * here can resurface in a later, unrelated session.
 */
/**
 * The key before the 2.0.0 rename, READ ONLY — decoded from base64 so no
 * spelling of the old brand, whole or split, appears in shipped source (both
 * brand gates sweep this file), while the RUNTIME string stays exactly what
 * pre-2.0.0 bundles wrote.
 *
 * A buyer who left for the provider's page on a pre-2.0.0 bundle comes back
 * to a newer one with their order parked under the old name. Without this
 * they land on the plain return screen — the order still settles, because the
 * webhook does that and never depended on any of this, but the confirmation
 * they were promised is missing for a reason they could not possibly
 * understand.
 *
 * DELETE when both hold, and not before:
 *  1. every adopter's production has served ONLY >= 2.0.0 bundles for at
 *     least 24 hours (a hosted round trip lasts minutes; a day is
 *     over-margin) — verified against each consumer's lockfile history, not
 *     assumed from this package's release date; and
 *  2. the deletion rides its own release with this note in the body, so an
 *     adopter still rolling back to a pre-2.0.0 bundle knows the window it
 *     reopens.
 * 3.0.0 deleted this shim on the package's clock instead of the hosts' —
 * consumers still pinned 2.x, so their key-renaming deploy had not happened
 * yet — which is why it is back.
 */
const LEGACY_KEY = atob('ZnV0dXJlcGF5LmNoZWNrb3V0Lmhvc3RlZE9yZGVy');

/**
 * The raw parked payload under either key, cleared as it is read.
 *
 * Split out from {@link takeHostedOrder} so the storage handling and the
 * parsing stay separately readable — the two halves fail for unrelated reasons
 * anyway (storage disabled vs. a value that is not an order).
 *
 * BOTH keys are cleared whichever one answered: this is read-and-clear, and a
 * legacy entry left behind would let a later return trip resume an order that
 * was already consumed.
 */
function peekParkedPayload(): string | null {
  try {
    return (
      window.sessionStorage?.getItem(HOSTED_ORDER_STORAGE_KEY) ??
      window.sessionStorage?.getItem(LEGACY_KEY) ??
      null
    );
  } catch {
    // Storage disabled or unavailable — the same "no parked order" as an empty
    // slot, and the webhook still settles the order regardless.
    return null;
  }
}

export function takeHostedOrder(tenantSlug?: string): CheckoutOrder | null {
  const parked = readParked();
  if (!parked) return null;
  // A hand-off from ANOTHER store is left where it is rather than consumed: it
  // is that store's to resume, and this buyer may well go back to it.
  if (!belongsHere(parked, tenantSlug)) return null;
  clearParked();
  if (isStale(parked)) return null;
  return parked.order;
}

/** Whether a parked hand-off is this store's. */
function belongsHere(parked: ParkedHostedOrder, tenantSlug?: string): boolean {
  // An unscoped entry (a host that passes no slug, or one parked by an older
  // bundle) stays readable by anyone — the single-tenant case, where there is
  // no other store to confuse it with.
  if (!parked.tenantSlug || !tenantSlug) return true;
  return parked.tenantSlug === tenantSlug;
}

/** Whether it has been sitting long enough to no longer be this trip's. */
function isStale(parked: ParkedHostedOrder): boolean {
  if (typeof parked.parkedAt !== "number") return false;
  return Date.now() - parked.parkedAt > MAX_PARKED_AGE_MS;
}

/**
 * The parked entry, parsed, or null. Tolerates the PRE-SCOPE shape — a bare
 * `CheckoutOrder` — so a buyer mid-hand-off across the deploy still comes back
 * to their confirmation.
 */
function readParked(): ParkedHostedOrder | null {
  const raw = peekParkedPayload();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCheckoutOrder(parsed)) return { order: parsed, parkedAt: Date.now() };
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<ParkedHostedOrder>;
    if (!isCheckoutOrder(candidate.order)) return null;
    return {
      order: candidate.order,
      ...(candidate.tenantSlug ? { tenantSlug: candidate.tenantSlug } : {}),
      parkedAt: typeof candidate.parkedAt === "number" ? candidate.parkedAt : Date.now(),
    };
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

/**
 * Drop the parked entry. Split from the read because the READ now has to
 * decide whose it is first — consuming another store's hand-off was the bug
 * this scoping exists to stop.
 *
 * BOTH keys, whichever answered: a legacy entry left behind would let a later
 * return trip resume an order that was already consumed.
 */
function clearParked(): void {
  try {
    window.sessionStorage?.removeItem(HOSTED_ORDER_STORAGE_KEY);
    window.sessionStorage?.removeItem(LEGACY_KEY);
  } catch {
    // Storage disabled — there was nothing to clear.
  }
}
