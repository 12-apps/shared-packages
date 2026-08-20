import {
  chargeSnapshotMismatch,
  hostedSnapshotMismatch,
} from '../core/charge-identity';
import type { ChargeSnapshot, Money, PaymentMethodKind } from '../core/types';

import { attachedChargeOf } from './runtime';
import type { AttachedCharge } from './types';

/**
 * WHAT A FIRST CHARGE TURNED OUT TO BE — read off the snapshot, never guessed
 * from the chain.
 *
 * A charge is raised, and only then is it known what the buyer can actually be
 * shown: a QR to copy, or a link to leave for. Deciding that up front from
 * whichever provider heads the merchant's chain is the defect this exists to
 * make impossible, and it has bitten twice:
 *
 *  - a PIX request that failed over onto a redirect provider was answered as a
 *    500 ("no PIX payload for a PIX charge") on a charge that was perfectly
 *    payable (FUT-563);
 *  - and the mirror image (FUT-747) — a merchant whose chain cannot tokenize a
 *    card in the browser is not thereby a hosted-only merchant. `hostedCard`
 *    is a statement about turning a PAN into an instrument, and a PIX charge
 *    has no PAN. Letting it pick the answer sent every PIX charge at such a
 *    merchant — a PIX-only provider honestly declaring `NONE` is exactly one —
 *    into the hosted branch, which threw on the missing link of a charge that
 *    was carrying a perfectly good QR.
 *
 * So the rule is one line and it belongs in one place: **PIX was asked for and
 * no link came back ⇒ answer with the QR; otherwise answer with the link.**
 * Everything else here is the guard that goes with each shape.
 */

/** Enough of a snapshot to name it in a refusal. */
type ChargeIdentity = { provider: string; providerChargeId: string };

/** Fallback window when a provider returns a QR but states no expiry. */
const PIX_FALLBACK_TTL_MS = 15 * 60 * 1000;

export type FirstChargeSettlement =
  /**
   * Not this payable's charge. `reason` is operator-facing; a caller maps it
   * onto whatever it tells the buyer. The identity rides along because the
   * refusal has to NAME the charge it refused — a mismatch nobody can trace to
   * a provider row is an alert with no next step.
   */
  | { kind: 'MISMATCH'; reason: string; charge: ChargeIdentity }
  /** Settles on the provider's own page — send the buyer to `hostedCheckoutUrl`. */
  | { kind: 'HOSTED'; hostedCheckoutUrl: string; charge: AttachedCharge }
  /** Settles here — show `qrText` until `expiresAt`. */
  | { kind: 'PIX'; qrText: string; expiresAt: string; charge: AttachedCharge };

export interface FirstChargeExpectation {
  /** What the payable is worth, decided server-side — never by the browser. */
  amount: Money;
  /** What was ASKED for. Only `PIX` can route to the QR branch. */
  method: PaymentMethodKind;
}

export interface FirstChargeOptions {
  /** Override the QR window used when the provider states none. */
  pixFallbackTtlMs?: number;
  /** Clock seam, so a caller can pin the fallback expiry in a test. */
  now?: () => number;
}

/**
 * Classify a raised snapshot into the shape the buyer is owed.
 *
 * THROWS for the two states no caller can answer: a hosted charge with no link
 * (nowhere to send the buyer — returning the bare payable strands them on a
 * payment step with no way to pay and no error), and a PIX charge with no
 * payload. Both are provider failures, not buyer-facing outcomes, which is why
 * they are not members of the union.
 */
/** The QR branch — see the routing rule in {@link classifyFirstCharge}. */
function settleAsPix(
  snapshot: ChargeSnapshot,
  expected: FirstChargeExpectation,
  options: FirstChargeOptions,
): FirstChargeSettlement {
  // FUT-377/378 — the QR shown must be THIS payable's, for THIS total. A
  // snapshot answered out of the gateway's store under a stale key would
  // otherwise be attached as the current charge, which is precisely the
  // reported symptom: the new total displayed beside the previous QR code.
  const reason = chargeSnapshotMismatch(snapshot, { method: 'PIX', amount: expected.amount });
  if (reason) return { kind: 'MISMATCH', reason, charge: snapshot };

  const pix = snapshot.pix;
  if (!pix) throw new Error('The provider returned no PIX payload for a PIX charge.');

  const clock = options.now ?? Date.now;
  const ttl = options.pixFallbackTtlMs ?? PIX_FALLBACK_TTL_MS;
  return {
    kind: 'PIX',
    qrText: pix.qrText,
    // The window the provider actually granted, not one we assumed.
    expiresAt: pix.expiresAt ?? new Date(clock() + ttl).toISOString(),
    charge: attachedChargeOf(snapshot),
  };
}

/** The link branch — everything the QR branch did not claim. */
function settleAsHosted(
  snapshot: ChargeSnapshot,
  expected: FirstChargeExpectation,
): FirstChargeSettlement {
  // Amount and currency only — see `hostedSnapshotMismatch`. Comparing the
  // METHOD here is what still refused a reused link: it was minted under
  // whichever method the buyer picked first, and they are free to pick another.
  const reason = hostedSnapshotMismatch(snapshot, { amount: expected.amount });
  if (reason) return { kind: 'MISMATCH', reason, charge: snapshot };

  const hostedCheckoutUrl = snapshot.hostedCheckoutUrl;
  if (!hostedCheckoutUrl) {
    throw new Error('The provider returned no hosted-checkout URL for a redirect charge.');
  }
  return { kind: 'HOSTED', hostedCheckoutUrl, charge: attachedChargeOf(snapshot) };
}

/**
 * Classify a raised snapshot into the shape the buyer is owed.
 *
 * THROWS for the two states no caller can answer: a hosted charge with no link
 * (nowhere to send the buyer — returning the bare payable strands them on a
 * payment step with no way to pay and no error), and a PIX charge with no
 * payload. Both are provider failures, not buyer-facing outcomes, which is why
 * they are not members of the union.
 */
export function classifyFirstCharge(
  snapshot: ChargeSnapshot,
  expected: FirstChargeExpectation,
  options: FirstChargeOptions = {},
): FirstChargeSettlement {
  // THE RULE. Asked for PIX and got no link back ⇒ this is a QR charge,
  // whatever the merchant's chain can or cannot tokenize.
  return expected.method === 'PIX' && !snapshot.hostedCheckoutUrl
    ? settleAsPix(snapshot, expected, options)
    : settleAsHosted(snapshot, expected);
}
