/**
 * WHAT IS IN THE BASKET, as one comparable fact (FUT-1213).
 *
 * A parked checkout has to be able to ask "is this still the basket the order
 * was raised from?" when the buyer comes back — and the answer cannot be the
 * cart's ID. Emptying a cart ("Esvaziar carrinho") keeps the row: the same id
 * comes back holding nothing, then holding something else entirely, and a
 * comparison on the id says "same basket" for a shopper who has thrown the old
 * one away and started again.
 *
 * So the identity is the LINES: which ones, and how many of each. Two baskets
 * with the same lines in a different order are the same basket; one extra unit
 * of one line is not.
 *
 * The HOST computes it, because the host owns the cart — this module only says
 * what shape the answer takes and how to build one from lines, so that every
 * adopter's signature is built the same way and a package-side comparison can
 * mean something.
 */

/** One line of the host's basket, reduced to what identity depends on. */
export interface CheckoutBasketLine {
  /** The line's own stable handle — a cart-line id, never a product id alone. */
  id: string;
  quantity: number;
}

/**
 * The lines' signature, or `null` for an empty basket.
 *
 * `null` rather than `""` because an EMPTY basket is a meaningful state on this
 * path rather than a missing answer: the server closes a cart when its order is
 * paid, so an empty basket is exactly what a buyer who paid comes back to.
 *
 * Sorted before joining, so the answer does not depend on the order the host
 * happens to hold its lines in — a re-fetch that returns them differently
 * sorted must not read as a different basket.
 *
 * The id is ENCODED before it is joined. `id + "x" + quantity` on a `|` join is
 * ambiguous the moment an id can contain either character: `[a×1, b×2]` and the
 * single line `["ax1|b" × 2]` produce the same string, and two different baskets
 * that compare equal is a resume over the wrong one. Unreachable with the cuid
 * and uuid ids every adopter has today — and this is exported for hosts whose
 * ids nobody here has seen, so it is encoded rather than argued about.
 */
export function basketSignature(lines: readonly CheckoutBasketLine[]): string | null {
  if (lines.length === 0) return null;
  return lines
    .map((line) => `${encodeURIComponent(line.id)}x${line.quantity}`)
    .sort()
    .join("|");
}

/**
 * The basket in front of the checkout right now, as the resume rule reads it.
 *
 * `ready` is not a nicety. The host's cart is fetched, so the first render of a
 * checkout has an EMPTY cart that is merely unloaded — and "empty" is the one
 * state the rule resumes on unconditionally (it is the paid buyer's normal
 * state). Deciding against an unseeded cart would resume every abandoned
 * hand-off on every mount, which is the bug this whole rule exists to remove.
 * So the decision waits.
 */
export interface CheckoutBasketIdentity {
  /** The lines' signature; `null` ⇒ the basket is empty. */
  signature: string | null;
  /** False while the host's cart is still loading — decide nothing yet. */
  ready: boolean;
}

/**
 * The signature to PARK with an order, or nothing.
 *
 * `undefined` — meaning "no basket was recorded" — for a host that names none
 * AND for a cart that has not answered yet. The second is the one worth
 * stating: a loading cart reports `signature: null`, which is the value that
 * means EMPTY, and an order parked as "raised from an empty basket" would later
 * be compared against the real one and read as a different basket. Recording
 * nothing is honest and degrades to the pre-1213 resume; recording `null` would
 * be a fact we do not have.
 */
export function parkedBasket(basket: CheckoutBasketIdentity | undefined): string | null | undefined {
  if (!basket || !basket.ready) return undefined;
  return basket.signature;
}
