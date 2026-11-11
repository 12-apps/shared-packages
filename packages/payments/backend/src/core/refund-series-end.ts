import { claimHeld } from './refund-retry';
import type { RefundRetryStore } from './refund-series-store';
import type { MerchantRef } from './types';

/**
 * End the series a host's undo takes back (FUT-4740 review S1), over a store the
 * host may bind to its own transaction (`createPrismaRefundRetryStore(tx.…)`),
 * so the end commits or rolls back with the undo. It never writes the table any
 * other way than the store's compare-and-set.
 *
 * Answers what the host may do with its own first-ask claim: `clearClaim` only
 * when a series was ended, no attempt of it is in flight, and every ask of it
 * was answered or consulted — a no-answer attempt 1 nothing has consulted yet
 * may have moved money (review S2), so its claim is kept.
 */
export async function endRefundSeriesFor(
  store: RefundRetryStore,
  match: { merchant: MerchantRef; reference: string; subject: string; boundTo: string },
  now: Date = new Date(),
): Promise<{ ended: boolean; clearClaim: boolean }> {
  const rows = (await store.findByReference(match.merchant, match.reference)).filter(
    (row) => row.subject === match.subject && row.boundTo === match.boundTo && row.settledAt === null,
  );
  let ended = false;
  let clearClaim = rows.length > 0;
  for (const row of rows) {
    const inFlight = claimHeld(row, now);
    const unconsulted = row.attempt <= 1 && row.refusal === 'UNKNOWN';
    if (inFlight || unconsulted) clearClaim = false;
    const saved = await store.saveIf({ ...row, settledAt: now.toISOString(), settledHow: 'ENDED', nextAt: null, claimedAt: null }, row.version);
    if (saved) ended = true;
    else clearClaim = false;
  }
  return { ended, clearClaim: ended && clearClaim };
}
