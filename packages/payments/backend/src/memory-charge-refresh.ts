import { mergeRefreshedSnapshot } from './core/snapshot-merge';
import { isForwardTransition } from './core/status';
import type { PendingTransition, StoredCharge } from './core/ports';
import type { ChargeSnapshot, MerchantRef, ProviderName } from './core/types';
import { merchantKey } from './memory-keys';

/**
 * The memory charge store's WRITES to an existing row — a refreshed snapshot
 * and the compare-and-set a manual confirmation needs — apart from
 * `memory.ts` for its size gate.
 */

/** The `(provider, providerChargeId)` UNIQUE constraint, as a map key. */
export const chargeKey = (provider: ProviderName, providerChargeId: string): string =>
  `${provider}:${providerChargeId}`;

/**
 * Apply a refreshed snapshot to the row it names — the body of
 * `upsertByProviderChargeId`, outside the factory purely for the size gate.
 *
 * A row can live under the provider's ORDER id when the charge id did not
 * exist yet at creation (PagBank's unpaid PIX, FUT-681), so a snapshot that
 * carries the order id as a hint is looked up there SECOND — a real charge-id
 * match always wins — and the row is then RE-KEYED to the charge id, which is
 * what the next webhook, poll and refund will present.
 */
export function applyRefreshedSnapshot(
  byChargeKey: Map<string, StoredCharge>,
  merchant: MerchantRef,
  snapshot: ChargeSnapshot,
): StoredCharge | null {
  const orderId = snapshot.settlementHints?.orderId;
  const row =
    byChargeKey.get(chargeKey(snapshot.provider, snapshot.providerChargeId)) ??
    (orderId && orderId !== snapshot.providerChargeId
      ? byChargeKey.get(chargeKey(snapshot.provider, orderId))
      : undefined);
  if (!row) return null;
  // Ownership check: a charge owned by another merchant is invisible to
  // this update — misattributed webhooks mutate nothing.
  if (merchantKey(row.merchant) !== merchantKey(merchant)) return null;
  if (!isForwardTransition(row.snapshot.status, snapshot.status)) return row;
  // Merged, not replaced — same rule as the Prisma store, so "refresh" means
  // the same thing in a test as in production.
  row.snapshot = mergeRefreshedSnapshot(row.snapshot, snapshot);
  if (row.providerChargeId !== row.snapshot.providerChargeId) {
    byChargeKey.delete(chargeKey(row.provider, row.providerChargeId));
    row.providerChargeId = row.snapshot.providerChargeId;
    byChargeKey.set(chargeKey(row.provider, row.providerChargeId), row);
  }
  row.updatedAt = new Date();
  return row;
}

/**
 * `ChargeStore.transitionPending`: write the snapshot ONLY while the row is
 * still PENDING — the compare-and-set two staff taps (confirm vs refuse) race
 * on. Synchronous over the map, so in this fake it is atomic by construction;
 * the Prisma store gets the same guarantee from a conditional `updateMany`.
 */
export function transitionPendingIn(
  byChargeKey: Map<string, StoredCharge>,
  merchant: MerchantRef,
  snapshot: ChargeSnapshot,
): PendingTransition {
  const row = byChargeKey.get(chargeKey(snapshot.provider, snapshot.providerChargeId));
  if (!row || merchantKey(row.merchant) !== merchantKey(merchant)) return { applied: false, stored: null };
  if (row.snapshot.status !== 'PENDING') return { applied: false, stored: row };
  row.snapshot = mergeRefreshedSnapshot(row.snapshot, snapshot);
  row.updatedAt = new Date();
  return { applied: true, stored: row };
}
