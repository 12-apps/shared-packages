import type { ChargeSnapshot } from './types';

/**
 * IS A CHARGE WE ALREADY RAISED STILL PAYABLE? (ported from the first adopting
 * host, FUT-760.)
 *
 * A per-attempt idempotency key deliberately raises a FRESH charge whenever the
 * previous attempt persisted one — which is right for a repriced order and
 * wrong for a buyer who simply tapped "pay" twice. There the honest answer is
 * the code they are already holding, because voiding the loser is not
 * available: `cancelCharge` is optional on the adapter, so on a provider that
 * implements none there is nothing to call and the buyer ends up holding two
 * payable codes for one order.
 *
 * WHICH charges to consider is a host query (its own rows, its own tenant
 * scope, its own idea of "this order"). What makes one of them PAYABLE is a
 * property of the snapshot alone, and that is what lives here — so a host asks
 * rather than re-deriving, and a new payment shape lands in one place.
 *
 * Deliberately snapshot-only: a status column can say PENDING while the
 * snapshot carries no code at all, and it is the code the buyer pays.
 */

/**
 * `true` only when a deadline is present AND already past.
 *
 * Fails OPEN in both unknown directions — an absent deadline and an
 * unparseable one both answer "not expired". A provider that reports no expiry
 * has not said the code lapsed, and a timestamp we cannot read says nothing
 * either; treating either as expired would strand a buyer whose QR is fine.
 */
export function chargeDeadlinePassed(expiresAt: string | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return false;
  return deadline <= now;
}

/**
 * A PIX snapshot the buyer can still pay: it carries a QR, and that QR has not
 * lapsed. The QR IS the charge for PIX, which is what makes handing an existing
 * one back the SAME answer rather than a stale one — unlike a card attempt,
 * which carries an instrument the buyer just chose.
 */
export function pixChargePayable(snapshot: ChargeSnapshot, now = Date.now()): boolean {
  const pix = snapshot.pix;
  if (!pix?.qrText) return false;
  return !chargeDeadlinePassed(pix.expiresAt, now);
}

/**
 * A hosted-checkout snapshot the buyer can still pay: it carries a link.
 *
 * No expiry clause, deliberately. A hosted provider keeps its page alive on its
 * own schedule and tells us nothing about it, so there is no honest local test;
 * a link the provider has since closed fails at the provider, which is the same
 * place it would have failed anyway.
 */
export function hostedChargePayable(snapshot: ChargeSnapshot): boolean {
  return Boolean(snapshot.hostedCheckoutUrl);
}
