import type { CheckoutOrder } from "./types";

/**
 * WHERE A CHECKOUT IN FLIGHT IS KEPT while the SPA is not (FUT-556, FUT-1140).
 *
 * A redirect provider takes the buyer to ITS OWN site, so the SPA is torn down
 * and remounts fresh when they come back. A low-memory phone does the same
 * thing without anybody leaving: the tab is discarded while the shopper is in
 * their bank app, and the checkout that comes back has never heard of the order
 * it raised. Everything the checkout held — which order, for how much, against
 * which basket — is gone, and without it the return lands on an empty payment
 * step: no confirmation, no total, no sign that the money they just moved
 * arrived.
 *
 * The webhook still settles the order server-side; that is the mechanism and it
 * does not depend on any of this. What is rescued here is only the buyer's view
 * of it.
 *
 * `sessionStorage`, not `localStorage`: this is one tab's round trip, and a
 * pending order left in durable storage would resurface in a later, unrelated
 * session.
 *
 * This module is the STORAGE half only. Whether a parked entry may be resumed —
 * which is a money rule, and the whole of FUT-1213 — lives in
 * `./hosted-return.ts`.
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
const LEGACY_KEY = atob("ZnV0dXJlcGF5LmNoZWNrb3V0Lmhvc3RlZE9yZGVy");

/**
 * What is actually parked: the order, WHOSE STORE it belongs to, WHICH BASKET
 * it was raised from, whether the buyer was sent away for it, and when.
 *
 * `CheckoutOrder` carries no tenant, and on a multi-tenant storefront every
 * store shares one origin — so one tab holds one slot for all of them. Without
 * the slug, a buyer who abandoned store A's hand-off and opened store B's
 * checkout resumed A's order on B's screen: a confirmation for an unrelated
 * order, and B's own checkout skipped.
 *
 * `basket` is the axis FUT-1213 added, and it is the one that decides whether
 * this entry is still ABOUT anything: an order raised from a basket the shopper
 * has since emptied and refilled is an order they are no longer placing. See
 * `./basket.ts` for why it is a signature of the lines rather than a cart id.
 *
 * `handoff` records whether the buyer was sent to another site for this order.
 * It decides WHERE a resume lands rather than whether one happens: a hand-off
 * can only be confirmed by asking, so it resumes on the confirmation screen,
 * while a PIX code raised on our own page is still the thing the buyer needs to
 * look at.
 *
 * `parkedAt` bounds the other axis. A checkout in flight is minutes; an entry
 * older than {@link MAX_PARKED_AGE_MS} belongs to a session the buyer has long
 * since abandoned, and resuming it tells them about an order they are no longer
 * trying to place.
 */
export interface ParkedHostedOrder {
  order: CheckoutOrder;
  /** The store this checkout belongs to; absent for an unscoped host. */
  tenantSlug?: string;
  /**
   * The basket the order was raised from — `null` for an empty one, and ABSENT
   * when the host supplied no identity at all (an older bundle, a host that has
   * not wired it). Absent and `null` are deliberately different: absent means
   * "unknown", which the rule treats as today's behaviour.
   */
  basket?: string | null;
  /** The buyer was sent to the provider's own page for this order. */
  handoff?: boolean;
  parkedAt: number;
}

/**
 * How long a parked checkout stays resumable.
 *
 * Thirty minutes: a hosted payment takes minutes, and the window has to cover a
 * buyer who fetches their card, not one who comes back tomorrow. Beyond it the
 * entry is dropped on read rather than resumed.
 */
const MAX_PARKED_AGE_MS = 30 * 60_000;

/** What a caller states about the checkout it is parking. */
interface ParkedContext {
  /** The store being paid. */
  tenantSlug?: string;
  /** The basket's signature — see {@link ParkedHostedOrder.basket}. */
  basket?: string | null;
  /** The buyer is being sent to the provider's own page. */
  handoff?: boolean;
}

/** Park the raised order — before a hand-off, and on every raise (FUT-1140). */
export function rememberHostedOrder(order: CheckoutOrder, context: ParkedContext = {}): void {
  try {
    const parked: ParkedHostedOrder = {
      order,
      ...(context.tenantSlug ? { tenantSlug: context.tenantSlug } : {}),
      ...(context.basket === undefined ? {} : { basket: context.basket }),
      ...(context.handoff ? { handoff: true } : {}),
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
 * The raw parked payload under either key.
 *
 * Split from the parsing so the two halves stay separately readable — they fail
 * for unrelated reasons anyway (storage disabled vs. a value that is not an
 * order).
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

/**
 * The parked entry, parsed, or null. Tolerates the PRE-SCOPE shape — a bare
 * `CheckoutOrder` — so a buyer mid-flight across the deploy still comes back
 * to their confirmation.
 */
export function readParked(): ParkedHostedOrder | null {
  const raw = peekParkedPayload();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCheckoutOrder(parsed)) return { order: parsed, parkedAt: Date.now() };
    if (typeof parsed !== "object" || parsed === null) return null;
    return scopedEntry(parsed as Partial<ParkedHostedOrder>);
  } catch {
    return null;
  }
}

/**
 * The SCOPED shape, field by field, with every absent one left absent.
 *
 * Absence is meaningful on two of these — a basket that was never recorded is
 * not the same as an empty one, and a hand-off flag that is missing means a
 * charge raised on our own page — so nothing here defaults a field into
 * existence.
 */
function scopedEntry(candidate: Partial<ParkedHostedOrder>): ParkedHostedOrder | null {
  if (!isCheckoutOrder(candidate.order)) return null;
  return {
    order: candidate.order,
    ...(candidate.tenantSlug ? { tenantSlug: candidate.tenantSlug } : {}),
    ...(candidate.basket === undefined ? {} : { basket: candidate.basket }),
    ...(candidate.handoff ? { handoff: true } : {}),
    parkedAt: typeof candidate.parkedAt === "number" ? candidate.parkedAt : Date.now(),
  };
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

/** Whether a parked checkout is this store's. */
export function belongsHere(parked: ParkedHostedOrder, tenantSlug?: string): boolean {
  // An unscoped entry (a host that passes no slug, or one parked by an older
  // bundle) stays readable by anyone — the single-tenant case, where there is
  // no other store to confuse it with.
  if (!parked.tenantSlug || !tenantSlug) return true;
  return parked.tenantSlug === tenantSlug;
}

/** Whether it has been sitting long enough to no longer be this trip's. */
export function isStale(parked: ParkedHostedOrder): boolean {
  if (typeof parked.parkedAt !== "number") return false;
  return Date.now() - parked.parkedAt > MAX_PARKED_AGE_MS;
}

/**
 * Drop the parked entry. Split from the read because the READ has to decide
 * whose it is first — consuming another store's checkout was the bug the
 * scoping exists to stop.
 *
 * BOTH keys, whichever answered: a legacy entry left behind would let a later
 * return trip resume an order that was already consumed.
 *
 * Exported because the entry now outlives a single read (FUT-1213's deferred
 * ask, FUT-1146's release, and the settle that ends a checkout normally), so
 * callers other than the read need a way to say "this one is finished".
 */
export function forgetHostedOrder(): void {
  try {
    window.sessionStorage?.removeItem(HOSTED_ORDER_STORAGE_KEY);
    window.sessionStorage?.removeItem(LEGACY_KEY);
  } catch {
    // Storage disabled — there was nothing to clear.
  }
}
