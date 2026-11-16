import { versionOf } from './decisions';
import type { CapturePatch, SaleDirectory, SaleRef, TerminalCaptureStore } from './ports';

/**
 * The refund sweep's held half (FUT-5095). A capture a sale holds
 * (ORDER_CREATED) was answered to the terminal as that sale's, so the terminal
 * never reports it again. When the sale is then abandoned — never paid, never
 * cancelled — nothing else would ever owe the money back.
 *
 * So, once the capture is a window old on both clocks, the sweep asks the host
 * which of the sales holding such captures were written a window ago and are
 * still unpaid, and flags those sales' captures `SALE_NOT_PAID`. A sale the
 * host does not name (paid, younger than the window, or one it cannot place)
 * keeps its captures as they are. Each flag is written only on the row as it
 * was read, so a bind or another flag landing in between wins, and a settle
 * that binds the capture never meets a flag on money it took.
 */

const saleKey = (sale: SaleRef): string => `${sale.clientId}\u0000${sale.orderId}`;

const PATCH = (now: Date): CapturePatch => ({ refundFlaggedAt: now, refundReason: 'SALE_NOT_PAID', refundClearedAt: null });

/** Flag up to `limit` stale held captures of unpaid sales. How many. 0 when the store or the host cannot answer the read. */
export async function flagStaleHeld<TTx>(
  store: TerminalCaptureStore,
  sales: SaleDirectory<TTx>,
  now: Date,
  cutoff: Date,
  limit: number,
): Promise<number> {
  if (!store.findStaleHeld || !sales.staleUnpaidSales) return 0;
  const held = (await store.findStaleHeld(cutoff, limit)).filter((row) => row.state === 'ORDER_CREATED' && row.orderId !== null);
  const asked = new Map<string, SaleRef>();
  for (const row of held) {
    const sale = { clientId: row.clientId, orderId: row.orderId as string };
    asked.set(saleKey(sale), sale);
  }
  if (asked.size === 0) return 0;
  // Only a sale this pass asked about: a stray answer flags nothing.
  const unpaid = new Set((await sales.staleUnpaidSales([...asked.values()], cutoff)).map(saleKey).filter((key) => asked.has(key)));
  let flagged = 0;
  for (const row of held) {
    if (!unpaid.has(saleKey({ clientId: row.clientId, orderId: row.orderId as string }))) continue;
    if (await store.writeIfUnchanged(versionOf(row), PATCH(now))) flagged += 1;
  }
  return flagged;
}
