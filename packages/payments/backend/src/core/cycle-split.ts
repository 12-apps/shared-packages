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
 */

type Split = NonNullable<RaisedCharge['installments']>;

interface SplitVerdict {
  split: Split | undefined;
  /** Why the returned charge is not the one asked for; null when it is. */
  mismatch: string | null;
}

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
 * One payment keeps today's path unchanged unless the returned charge itself
 * reports a split: no amount is compared there, so a host whose charges carry
 * no count reads exactly as it always has.
 */
export function splitOf(
  snapshot: ChargeSnapshot,
  cycle: CollectableCycle,
  quote: InstallmentQuote | null,
): SplitVerdict {
  if (!quote) {
    const split = reportedSplit(snapshot, cycle);
    return { split, mismatch: split ? countMismatch(snapshot, 1) : null };
  }
  const mismatch =
    chargeSnapshotMismatch(snapshot, { method: 'CARD', amount: quote.total }) ??
    countMismatch(snapshot, quote.installments);
  if (mismatch) return { split: reportedSplit(snapshot, cycle), mismatch };
  return { split: { count: quote.installments, principal: cycle.amount, total: quote.total }, mismatch: null };
}
