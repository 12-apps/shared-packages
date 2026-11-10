import { chargeSnapshotMismatch } from './charge-identity';
import type { CollectableCycle, RaisedCharge } from './cycle-collection';
import type { InstallmentQuote } from './installments';
import type { ChargeSnapshot } from './types';

/**
 * The split a collected card cycle records (FUT-4382) — taken from the charge
 * that CAME BACK, never from the one asked for.
 *
 * `gateway.charge` answers a known idempotency key (the cycle's id) with the
 * charge already stored under it, without calling the provider: an earlier
 * sweep's 3x whose `recordRaised` failed comes back to a retry asking for 6x,
 * 1x or the same count at a moved rate. Stamping the NEW quote's split on that
 * charge would record a price nobody paid. Kept out of `cycle-collection.ts`,
 * which sits at its size ceiling.
 *
 * The count is checked only where the adapter reports one
 * (`ChargeSnapshot.installments`); none does yet. Without it, a count is
 * recorded only for a charge THIS call raised — its row created after the call
 * began — and otherwise left out with `count-unconfirmed`.
 */

type Split = NonNullable<RaisedCharge['installments']>;

/** What the gateway handed back, and when this call began asking for it. */
export interface ReturnedCharge {
  provider: string;
  providerChargeId: string;
  snapshot: ChargeSnapshot;
  /** The stored row's creation; a host's own gateway may not say. */
  createdAt?: Date;
  since: Date;
}

interface SplitVerdict {
  split: Split | undefined;
  /** Why the returned charge is not (or not provably) the one asked for; null when it is. */
  mismatch: string | null;
  /** The method to record: the returned charge's own, which a mismatch can make PIX. */
  method: 'PIX' | 'CARD';
}

const COUNT_UNCONFIRMED = 'count-unconfirmed';

/** The split the returned charge itself reports, if it reports more than one payment. */
function reportedSplit(snapshot: ChargeSnapshot, cycle: CollectableCycle): Split | undefined {
  const count = snapshot.installments;
  return typeof count === 'number' && count > 1
    ? { count, principal: cycle.amount, total: snapshot.amount }
    : undefined;
}

/** A count the returned charge reports that differs from the one asked for, as a reason. */
function countMismatch(snapshot: ChargeSnapshot, asked: number): string | null {
  const count = snapshot.installments;
  if (typeof count !== 'number' || count === asked) return null;
  return `expected ${asked} installment${asked === 1 ? '' : 's'}, got ${count}`;
}

/**
 * A partial snapshot (a host's fake with no amount) is never compared: one
 * payment must read exactly as it always has wherever nothing differs.
 */
function amountMismatch(snapshot: ChargeSnapshot, asked: ChargeSnapshot['amount']): string | null {
  const reported: Partial<ChargeSnapshot> = snapshot;
  if (!reported.amount || !reported.method) return null;
  return chargeSnapshotMismatch(snapshot, { method: 'CARD', amount: asked });
}

const freshlyRaised = (charge: ReturnedCharge) =>
  charge.createdAt instanceof Date && charge.createdAt.getTime() >= charge.since.getTime();

/** The split a matching N-payment charge records — its count only where confirmed. */
function quotedSplit(charge: ReturnedCharge, cycle: CollectableCycle, quote: InstallmentQuote) {
  const base = { principal: cycle.amount, total: quote.total };
  if (typeof charge.snapshot.installments === 'number' || freshlyRaised(charge)) {
    return { split: { count: quote.installments, ...base }, mismatch: null };
  }
  return { split: base, mismatch: COUNT_UNCONFIRMED };
}

export function splitOf(
  charge: ReturnedCharge,
  cycle: CollectableCycle,
  quote: InstallmentQuote | null,
): SplitVerdict {
  const { snapshot } = charge;
  const method = snapshot.method === 'PIX' ? 'PIX' : 'CARD';
  const asked = quote ? { amount: quote.total, count: quote.installments } : { amount: cycle.amount, count: 1 };
  const mismatch = amountMismatch(snapshot, asked.amount) ?? countMismatch(snapshot, asked.count);
  if (mismatch) return { split: reportedSplit(snapshot, cycle), mismatch, method };
  if (!quote) return { split: undefined, mismatch: null, method };
  return { ...quotedSplit(charge, cycle, quote), method };
}
