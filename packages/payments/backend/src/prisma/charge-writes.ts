import { PaymentsError } from '../core/errors';
import type { ChargeStore, PendingTransition, StoredCharge } from '../core/ports';
import { mergeRefreshedSnapshot } from '../core/snapshot-merge';
import { isForwardTransition } from '../core/status';
import type { ChargeSupersession } from '../core/supersession';
import type { ChargeSnapshot, MerchantRef } from '../core/types';

import type { ChargeDelegate } from './stores';

/**
 * EVERY WRITE TO A STORED CHARGE IS A COMPARE-AND-SET ON ITS VERSION (FUT-4072).
 *
 * Each write here MERGES into the row it read — a refresh over the stored
 * snapshot, a supersede mark into it — so a plain read-then-write loses
 * whatever another writer put on the row in between. Two of those losses are
 * money: a webhook that read the row before the checkout marked it superseded
 * wrote `merge(stale, PAID)` and ERASED the mark, so the host applied the old
 * link's payment as the payable's current one; and a mark that read the row
 * before a same-status refresh rolled that refresh back (an InfinitePay
 * `transaction_nsu` lost, a FUT-681 re-key reverted).
 *
 * So the WHERE carries the `updatedAt` the merge was computed from — Prisma's
 * `@updatedAt` moves on every write, `updateMany` included, which makes it the
 * row's version without a migration — and a write that matches nothing re-reads
 * and re-merges from the row as it now stands. The version has millisecond
 * resolution: two writes inside one millisecond are not told apart, a window
 * far narrower than the read-merge-write gap this closes.
 */

/** The columns a charge write sets. */
interface RowData {
  snapshot: unknown;
  status: string;
  amountCents: number;
  method: string;
  providerChargeId: string;
}

/** Lost races tolerated before a write gives up loudly. */
const MAX_TRIES = 5;

function rowDataOf(snapshot: ChargeSnapshot): RowData {
  return {
    snapshot,
    status: snapshot.status,
    amountCents: snapshot.amount.amountCents,
    method: snapshot.method,
    providerChargeId: snapshot.providerChargeId,
  };
}

/**
 * The columns a REFRESH writes — MERGED over the stored snapshot, never
 * replacing it, because a re-read answers what happened to the charge and must
 * not erase what creating it established ({@link mergeRefreshedSnapshot}).
 *
 * `amountCents` and `method` are rewritten alongside the snapshot deliberately:
 * they are what every lookup filters on, so leaving them behind lets a row
 * disagree with itself and hides a settled charge's real captured amount from
 * every query that reads it.
 *
 * `providerChargeId` is rewritten for the same reason (FUT-681): a PIX row is
 * created under the provider's ORDER id — the only id an unpaid PIX has — and
 * the refresh that learns the real charge id must RE-KEY the row, or every
 * later lookup by that id (the next webhook, a refund) misses it. For a
 * refresh found by its own id this writes the value already there.
 */
function refreshedRow(stored: ChargeSnapshot, refreshed: ChargeSnapshot): RowData {
  return rowDataOf(mergeRefreshedSnapshot(stored, refreshed));
}

/**
 * The stored row a refreshed snapshot names: by its charge id first, then —
 * when the snapshot labels a distinct ORDER id — by that (FUT-681). A PIX row
 * is created under the order id because an unpaid PIX has no charge id yet;
 * the paid webhook presents the real charge id plus the order-id hint, and
 * without the second lookup it updates nothing, forever.
 */
async function storedRowFor(
  store: Pick<ChargeStore, 'findByProviderChargeId'>,
  snapshot: ChargeSnapshot,
): Promise<StoredCharge | null> {
  const direct = await store.findByProviderChargeId(snapshot.provider, snapshot.providerChargeId);
  if (direct) return direct;
  const orderId = snapshot.settlementHints?.orderId;
  if (!orderId || orderId === snapshot.providerChargeId) return null;
  return store.findByProviderChargeId(snapshot.provider, orderId);
}

function ownedBy(row: StoredCharge, merchant: MerchantRef): boolean {
  return row.merchant.kind === merchant.kind && row.merchant.id === merchant.id;
}

interface CasPlan {
  /** Read the row as it stands now. */
  read(): Promise<StoredCharge | null>;
  /** The columns to write over THIS row, or null to write nothing. */
  next(row: StoredCharge): RowData | null;
  /** An extra WHERE clause the write must also match. */
  status?: string;
}

/** Read, merge, write-if-unchanged; re-read and re-merge on a lost race. */
async function casWrite(
  delegate: ChargeDelegate,
  plan: CasPlan,
): Promise<{ written: boolean; row: StoredCharge | null }> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    const row = await plan.read();
    if (!row) return { written: false, row: null };
    const data = plan.next(row);
    if (!data) return { written: false, row };
    const { count } = await delegate.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt, ...(plan.status ? { status: plan.status } : {}) },
      data,
    });
    if (count === 1) return { written: true, row: null };
  }
  throw new PaymentsError('ChargeWriteContention', `charge row kept changing under a write (${MAX_TRIES} tries)`);
}

/** `ChargeStore.upsertByProviderChargeId` over Prisma. */
export async function upsertRow(
  delegate: ChargeDelegate,
  store: Pick<ChargeStore, 'findByProviderChargeId'>,
  merchant: MerchantRef,
  snapshot: ChargeSnapshot,
): Promise<StoredCharge | null> {
  const outcome = await casWrite(delegate, {
    read: () => storedRowFor(store, snapshot),
    next: (row) =>
      ownedBy(row, merchant) && isForwardTransition(row.snapshot.status, snapshot.status)
        ? refreshedRow(row.snapshot, snapshot)
        : null,
  });
  if (!outcome.written) return outcome.row && ownedBy(outcome.row, merchant) ? outcome.row : null;
  return storedRowFor(store, snapshot);
}

/**
 * `ChargeStore.transitionPending` over Prisma. The status in the WHERE is what
 * makes two concurrent staff taps resolve to exactly one winner; the version is
 * what keeps the winner's merge from overwriting a write it did not read.
 */
export async function transitionPendingRow(
  delegate: ChargeDelegate,
  store: Pick<ChargeStore, 'findByProviderChargeId'>,
  merchant: MerchantRef,
  snapshot: ChargeSnapshot,
): Promise<PendingTransition> {
  const read = () => store.findByProviderChargeId(snapshot.provider, snapshot.providerChargeId);
  const outcome = await casWrite(delegate, {
    read,
    next: (row) =>
      ownedBy(row, merchant) && row.snapshot.status === 'PENDING' ? refreshedRow(row.snapshot, snapshot) : null,
    status: 'PENDING',
  });
  const stored = await read();
  if (!stored || !ownedBy(stored, merchant)) return { applied: false, stored: null };
  return { applied: outcome.written, stored };
}

/**
 * `ChargeQueryStore.markSuperseded` over Prisma: the mark merged into the row
 * as it stands, never over a status or a refresh it did not read. The FIRST
 * mark stands — a second one for the same charge writes nothing.
 */
export async function markSupersededRow(
  delegate: ChargeDelegate,
  store: Pick<ChargeStore, 'findByProviderChargeId'>,
  merchant: MerchantRef,
  key: { provider: string; providerChargeId: string },
  supersession: ChargeSupersession,
): Promise<void> {
  await casWrite(delegate, {
    read: () => store.findByProviderChargeId(key.provider, key.providerChargeId),
    next: (row) =>
      ownedBy(row, merchant) && !row.snapshot.superseded
        ? rowDataOf({ ...row.snapshot, superseded: supersession })
        : null,
  });
}
