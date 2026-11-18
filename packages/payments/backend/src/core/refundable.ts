import type { ChargeSnapshot } from './types';

/**
 * What a captured charge can still give back, by the provider's own figure
 * (FUT-4951): the captured amount less `refundedAmount`, never below 0. Null
 * when the snapshot carries no `refundedAmount`, which means the adapter
 * cannot say, never that nothing went back. A host reads it off the stored
 * snapshot (`mergeRefreshedSnapshot` keeps the last figure seen), so asking
 * costs no provider call.
 */
export function refundableCents(snapshot: Pick<ChargeSnapshot, 'amount' | 'refundedAmount'>): number | null {
  if (!snapshot.refundedAmount) return null;
  return Math.max(0, snapshot.amount.amountCents - snapshot.refundedAmount.amountCents);
}
