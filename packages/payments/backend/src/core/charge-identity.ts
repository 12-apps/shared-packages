import { ownsReference } from './reference';
import type { ChargeSnapshot, Money, PaymentMethodKind } from './types';

/**
 * WHAT CAME BACK IS NOT NECESSARILY WHAT WE ASKED FOR (FUT-378).
 *
 * `gateway.charge` answers a KNOWN idempotency key with the charge already
 * stored under it, without calling the provider at all — so a returned snapshot
 * can describe a different method, or a different amount, than the attempt that
 * just asked for it.
 *
 * No caller may write payment bookkeeping from a snapshot it has not
 * recognized. The reported failure is what happens when one does: a card
 * attempt received the payable's earlier PIX charge, read its `PENDING` status
 * as a business decline, failed the payable and stamped the live QR's charge id
 * onto a payment row marked DECLINED — after which paying that QR settled
 * nothing, because its id was already spoken for.
 *
 * Per-attempt idempotency keys (`checkout/raise.ts`, FUT-377) are the fix;
 * these are the checks that the fix held. They live in `core/` rather than in
 * the host that wrote them because they are pure functions over the library's
 * own types, guarding the library's own walk — a host cannot be trusted to
 * re-derive them, and until FUT-740 every host had to.
 */

/**
 * Compare a returned charge snapshot against the attempt that asked for it.
 * Returns a short operator-facing reason, or `null` when the snapshot IS this
 * attempt's charge.
 */
export function chargeSnapshotMismatch(
  snapshot: ChargeSnapshot,
  expected: { method: PaymentMethodKind; amount: Money },
): string | null {
  if (snapshot.method !== expected.method) {
    return `expected a ${expected.method} charge, got ${snapshot.method}`;
  }
  if (snapshot.amount.amountCents !== expected.amount.amountCents) {
    return `expected ${expected.amount.amountCents} cents, got ${snapshot.amount.amountCents}`;
  }
  if (snapshot.amount.currency !== expected.amount.currency) {
    return `expected ${expected.amount.currency}, got ${snapshot.amount.currency}`;
  }
  return null;
}

/**
 * The same check for a HOSTED-CHECKOUT charge — amount and currency only.
 *
 * The method is deliberately NOT compared. On a redirect provider the buyer
 * chooses how to pay on the PROVIDER's page, so the method we sent constrains
 * nothing: it is a hint at link-creation time, not a property of the charge.
 *
 * It has to be dropped rather than merely tolerated, because reuse makes the
 * two disagree routinely (FUT-606). A re-tap is answered with the link the
 * buyer already has, and that link was minted under whichever method they
 * picked the FIRST time — so a buyer who tried card, came back and chose PIX
 * got their own live link refused as "not this attempt's charge", which is the
 * dead end the reuse existed to remove.
 *
 * What still holds is everything that touches money: a link for a different
 * amount, or in a different currency, is not this payable's and is refused.
 */
export function hostedSnapshotMismatch(
  snapshot: ChargeSnapshot,
  expected: { amount: Money },
): string | null {
  // A charge nobody has paid yet reports NOTHING CAPTURED, not a price of zero.
  //
  // That distinction is what made a re-tap unpayable (FUT-669). The buyer
  // opened the hosted page and did not pay; the next attempt re-read the
  // charge, the provider answered "not paid" — 0 cents, because `getCharge`
  // passes no amount fallback — and this guard read it as the wrong price and
  // refused. Every retry refused identically, so the payable could never be
  // paid: `expected 7500 cents, got 0`, forever.
  //
  // The guard still does its job where it matters: a SETTLED snapshot carries a
  // real captured amount, and a mismatch there is the undercharge this exists
  // to catch.
  const captured = snapshot.amount.amountCents;
  const unsettled = snapshot.status === 'PENDING' || snapshot.status === 'AUTHORIZED';
  if (!(unsettled && captured === 0) && captured !== expected.amount.amountCents) {
    return `expected ${expected.amount.amountCents} cents, got ${captured}`;
  }
  if (snapshot.amount.currency !== expected.amount.currency) {
    return `expected ${expected.amount.currency}, got ${snapshot.amount.currency}`;
  }
  return null;
}

/**
 * The identity half of the same check, on the STORED ROW rather than the
 * snapshot — "right payable, right attempt" (FUT-378).
 *
 * The snapshot cannot answer either question: `ChargeSnapshot` carries no
 * idempotency key, so `chargeSnapshotMismatch` can only tell a charge apart by
 * what it LOOKS like (method, amount, currency). Two charges of one payable
 * that differ only by attempt look identical — which is exactly the pair that
 * gets confused, because the store is insert-or-return-existing on
 * `(provider, providerChargeId)` as well as on the key: a provider that dedupes
 * on its own reference answers this attempt with the charge it created for the
 * LAST one, and the store hands back that earlier row.
 *
 * Accepting it means writing bookkeeping against a charge nobody raised now:
 * its PENDING status reads as a decline, and its id — the id of a charge the
 * buyer can still pay — lands on a DECLINED payment row, after which the real
 * settlement collides on that id. The buyer pays and nothing settles.
 *
 * So this is deliberately EXACT-MATCH and fails closed: anything that is not
 * provably the row this attempt just stored is refused.
 */
export function chargeIdentityMismatch(
  charge: { reference: string; idempotencyKey: string | null },
  expected: { reference: string; idempotencyKey: string },
): string | null {
  if (!ownsReference(expected.reference, charge.reference)) {
    return `expected a charge for ${expected.reference}, got one for ${charge.reference}`;
  }
  if (charge.idempotencyKey !== expected.idempotencyKey) {
    return (
      `expected attempt ${expected.idempotencyKey}, got a charge stored under ` +
      `${charge.idempotencyKey ?? 'no key'}`
    );
  }
  return null;
}

/**
 * A charge that came back is NOT the one this attempt raised.
 *
 * A distinct error type, not a returned value, because every caller must fail
 * closed on it and none may carry on with the snapshot. It is a BUG condition,
 * never a business outcome: it maps to a 409 that records nothing, rather than
 * to a decline.
 *
 * Carries the offending charge's provider + id so the refusal can name, in the
 * server log, the charge an operator has to go and reconcile.
 */
export class ChargeIdentityError extends Error {
  readonly provider: string;
  readonly providerChargeId: string;
  /** The operator-facing reason, ready to log. */
  readonly mismatch: string;

  constructor(charge: { snapshot: ChargeSnapshot }, mismatch: string) {
    super(`charge identity mismatch: ${mismatch}`);
    this.name = 'ChargeIdentityError';
    this.provider = charge.snapshot.provider;
    this.providerChargeId = charge.snapshot.providerChargeId;
    this.mismatch = mismatch;
  }
}
