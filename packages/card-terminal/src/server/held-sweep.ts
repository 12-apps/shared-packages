import { versionOf } from './decisions';
import type { TerminalCaptureRecord } from './model';
import type { CapturePatch, SaleDirectory, SaleRef, StaleHeldCursor, TerminalCaptureStore } from './ports';

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

/**
 * Pages one call may read before it stops for the tick. The read goes on past
 * rows the host does not name (a paid sale's leftover ORDER_CREATED capture, a
 * sale younger than the window), so a head of such rows cannot hide a newer
 * abandoned capture; this only bounds one tick's work.
 */
export const HELD_SWEEP_PAGES = 5;

/**
 * Where the next call resumes. Kept by the ledger across ticks, so a backlog
 * of rows never flagged longer than {@link HELD_SWEEP_PAGES} pages is still
 * walked past, a few pages a tick; reset once a read reaches the end, so the
 * next tick starts again from the oldest row (a young sale is a window old by
 * then). Per process: a second worker walks on its own, which costs reads, not
 * correctness, since every flag is a compare-and-set.
 */
export interface HeldSweepState {
  after?: StaleHeldCursor;
}

const saleKey = (sale: SaleRef): string => `${sale.clientId}\u0000${sale.orderId}`;

const PATCH = (now: Date): CapturePatch => ({ refundFlaggedAt: now, refundReason: 'SALE_NOT_PAID', refundClearedAt: null });

/** Both ports the held half reads through; without either, it does nothing. */
export function heldSweepReady<TTx>(store: TerminalCaptureStore, sales: SaleDirectory<TTx>): boolean {
  return typeof store.findStaleHeld === 'function' && typeof sales.staleUnpaidSales === 'function';
}

interface Pass<TTx> {
  store: TerminalCaptureStore;
  sales: SaleDirectory<TTx>;
  now: Date;
  cutoff: Date;
}

const saleOf = (row: TerminalCaptureRecord): SaleRef => ({ clientId: row.clientId, orderId: row.orderId as string });

/** The sales of `rows` the host names unpaid. Only a sale this page asked about counts: a stray answer flags nothing. */
async function unpaidOf<TTx>(pass: Pass<TTx>, rows: readonly TerminalCaptureRecord[]): Promise<Set<string>> {
  const asked = new Map<string, SaleRef>();
  for (const row of rows) asked.set(saleKey(saleOf(row)), saleOf(row));
  if (asked.size === 0 || !pass.sales.staleUnpaidSales) return new Set();
  const answer = await pass.sales.staleUnpaidSales([...asked.values()], pass.cutoff);
  return new Set(answer.map(saleKey).filter((key) => asked.has(key)));
}

/**
 * One page: flag, oldest first, at most `room` rows whose sale is unpaid.
 * Answers how many it flagged and the last row it looked at.
 */
async function flagPage<TTx>(
  pass: Pass<TTx>,
  page: readonly TerminalCaptureRecord[],
  room: number,
): Promise<{ flagged: number; last: TerminalCaptureRecord | undefined }> {
  const unpaid = await unpaidOf(
    pass,
    page.filter((row) => row.state === 'ORDER_CREATED' && row.orderId !== null),
  );
  let flagged = 0;
  let last: TerminalCaptureRecord | undefined;
  for (const row of page) {
    if (flagged >= room) break;
    last = row;
    if (row.state !== 'ORDER_CREATED' || row.orderId === null || !unpaid.has(saleKey(saleOf(row)))) continue;
    // N1 (FUT-5095): a sale paid by another tender between the host's answer and this write, its
    // capture left ORDER_CREATED, is still flagged; a bind in between makes the write match nothing.
    if (await pass.store.writeIfUnchanged(versionOf(row), PATCH(pass.now))) flagged += 1;
  }
  return { flagged, last };
}

/**
 * Flag up to `limit` stale held captures of unpaid sales, reading on in pages
 * of `limit` from `state.after` (at most {@link HELD_SWEEP_PAGES}). How many.
 * 0 when the store or the host cannot answer the read ({@link heldSweepReady}).
 *
 * N6 (FUT-5095): a sale the host still holds open past the window (a pedido
 * left to be received later) is flagged too, and a bind never clears the
 * flag: a receive after the window charges again.
 */
export async function flagStaleHeld<TTx>(
  store: TerminalCaptureStore,
  sales: SaleDirectory<TTx>,
  window: { now: Date; cutoff: Date; limit: number },
  state: HeldSweepState,
): Promise<number> {
  if (!store.findStaleHeld || !heldSweepReady(store, sales)) return 0;
  const pass: Pass<TTx> = { store, sales, now: window.now, cutoff: window.cutoff };
  let flagged = 0;
  for (let read = 0; read < HELD_SWEEP_PAGES && flagged < window.limit; read += 1) {
    const page = await store.findStaleHeld(window.cutoff, window.limit, state.after);
    const done = await flagPage(pass, page, window.limit - flagged);
    flagged += done.flagged;
    state.after = done.last ? { capturedAt: done.last.capturedAt, id: done.last.id } : state.after;
    if (page.length < window.limit && done.last === page[page.length - 1]) {
      state.after = undefined;
      break;
    }
  }
  return flagged;
}
