import type { NormalizedWebhookEvent } from './webhook-event-types';

/**
 * IS THIS EVENT A REVERSAL, AND WHAT DID IT REVERSE? (ported from the first
 * adopting host, FUT-760.)
 *
 * A provider-confirmed refund or chargeback is a settlement UNDONE, and a host
 * that ignores one keeps saying PAID for money the buyer already has back. But
 * before a host can react it has to answer a question that is pure surface
 * mechanism — which shape of reversal this delivery is, and which fields carry
 * the facts. That question has three answers and every one of them is a rule of
 * the webhook contract rather than of any host:
 *
 *   - `DISPUTE_UPDATED` — money HELD, neither outcome decided. It carries
 *     neither snapshot by design, so its facts come off `raw`.
 *   - a charge snapshot reading `REFUNDED` — the charge's own state says the
 *     money went back (an Orders-API refund webhook, a legacy resolver's
 *     chargeback mapping).
 *   - `REFUND_UPDATED` with a refund fact reading `REFUNDED` — the ledger
 *     fact, emitted ALONGSIDE the above by chargebacks and ALONE by providers
 *     that only ever announce the refund object.
 *
 * `PARTIALLY_REFUNDED` is deliberately NOT a reversal: part of the money
 * stands, so "no longer paid" would overstate it exactly the way PAID
 * overstates it. The charge row still records the state.
 *
 * What a host does about it — park the order, write the audit row, alert
 * finance — stays the host's, along with the fallback lookup when no reference
 * is named. This decides only what happened.
 */

/** A dispute opened: money held, no outcome yet. */
export interface DisputeFacts {
  kind: 'DISPUTE';
  /**
   * The reference the disputed charge was created under, when the payload
   * names one. A dispute reported through a legacy surface may name only a
   * transaction code, in which case there is nothing here to resolve.
   */
  reference: string | null;
  /** The provider-side handle an operator reconciles against, if given. */
  providerChargeId: string | null;
}

/** A settlement undone: the buyer has the money back. */
export interface RefundFacts {
  kind: 'REFUND';
  /**
   * Host reference the charge was created under. Null when the event named
   * none — the host then falls back to its own stored row, which is why this
   * is reported rather than treated as "not a reversal".
   */
  reference: string | null;
  /** The provider-side handle an operator reconciles against. */
  providerChargeId: string;
  /** What the provider actually reversed — never what the order is worth. */
  refundedCents: number;
}

export type ReversalFacts = DisputeFacts | RefundFacts;

/**
 * A non-empty string field read off a payload the type does not describe.
 * `raw` is `unknown` by contract, and a dispute's detail is the one place a
 * host has to reach into it.
 */
function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

/**
 * What this event reverses, or null when it reverses nothing (the caller then
 * falls through to its settle path).
 *
 * Never throws and never widens: an event of an unknown type, a charge
 * snapshot in any state but `REFUNDED`, and a refund fact still `PENDING` all
 * answer null, so a host that routes on this cannot mistake a payment for its
 * own undoing.
 */
export function classifyReversalEvent(event: NormalizedWebhookEvent): ReversalFacts | null {
  if (event.type === 'DISPUTE_UPDATED') {
    return {
      kind: 'DISPUTE',
      // A dispute carries no snapshot by contract, so its handles live on the
      // raw detail the resolver preserved.
      reference: stringField(event.raw, 'reference'),
      providerChargeId: stringField(event.raw, 'transactionCode'),
    };
  }

  const charge = event.charge;
  if (charge?.status === 'REFUNDED') {
    return {
      kind: 'REFUND',
      reference: charge.reference ?? null,
      providerChargeId: charge.providerChargeId,
      refundedCents: charge.amount.amountCents,
    };
  }

  const refund = event.refund;
  if (event.type === 'REFUND_UPDATED' && refund?.status === 'REFUNDED') {
    return {
      kind: 'REFUND',
      reference: refund.reference ?? null,
      providerChargeId: refund.providerChargeId,
      refundedCents: refund.amount.amountCents,
    };
  }

  return null;
}
