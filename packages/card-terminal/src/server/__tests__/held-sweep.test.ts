import { describe, expect, it } from 'vitest';

import { createTerminalCaptureLedger } from '../ledger';
import type { SaleDirectory } from '../ports';
import { DAY, NOW, OTHER_TENANT, TENANT, capture, refusal, world, type World } from './world';

/**
 * The sweep's held half (FUT-5095): a capture a sale holds (ORDER_CREATED) was
 * answered to the terminal as that sale's, so the terminal never reports it
 * again. When the sale is then abandoned — never paid, never cancelled — the
 * money would be kept with no sale and no refund. The sweep flags it
 * `SALE_NOT_PAID` once the capture AND the sale are a window old and the host
 * still names the sale unpaid, and never a capture whose sale is paid.
 */

const ago = (ms: number) => new Date(NOW.getTime() - ms);
const key = (transactionCode: string, clientId = TENANT) => ({ clientId, transactionCode });

/** A capture taken and recorded at `at`, held by a sale written at `saleAt`. */
async function held(w: World, code: string, at: Date, options: { clientId?: string; saleAt?: Date } = {}) {
  const clientId = options.clientId ?? TENANT;
  const sale = w.sale(clientId, options.saleAt ?? at);
  await w.ledger.record(capture({ clientId, transactionCode: code, capturedAt: at }));
  w.captures.setRecordedAt(clientId, code, at);
  await w.ledger.markSaleCreated(null, key(code, clientId), sale.orderId);
  return sale;
}

describe('the held-capture sweep', () => {
  it('flags the held captures of a sale left unpaid through the window, across tenants, and nothing else', async () => {
    const w = world();
    await held(w, 'ABANDONED', ago(DAY + 60_000));
    await held(w, 'AT-THE-LINE', ago(DAY));
    await held(w, 'ABANDONED-ELSEWHERE', ago(2 * DAY), { clientId: OTHER_TENANT });
    const paid = await held(w, 'PAID', ago(2 * DAY));
    w.pay(paid.orderId);
    await held(w, 'FRESH', ago(DAY - 60_000));
    await held(w, 'YOUNG-SALE', ago(2 * DAY), { saleAt: ago(60_000) });
    const cancelled = await held(w, 'CANCELLED', ago(2 * DAY));
    await w.ledger.flagSale(TENANT, cancelled.orderId, 'SALE_CANCELLED');
    await w.ledger.record(capture({ transactionCode: 'UNBOUND', capturedAt: ago(2 * DAY) }));
    w.captures.setRecordedAt(TENANT, 'UNBOUND', ago(2 * DAY));

    await expect(w.ledger.flagStaleHeld(NOW, 100)).resolves.toBe(3);

    for (const [code, tenant] of [['ABANDONED', TENANT], ['AT-THE-LINE', TENANT], ['ABANDONED-ELSEWHERE', OTHER_TENANT]] as const) {
      expect(w.row(code, tenant), code).toMatchObject({ state: 'ORDER_CREATED', refundFlaggedAt: NOW, refundReason: 'SALE_NOT_PAID', refundClearedAt: null });
    }
    for (const code of ['PAID', 'FRESH', 'YOUNG-SALE', 'UNBOUND']) {
      expect(w.row(code), code).toMatchObject({ refundFlaggedAt: null, refundReason: null });
    }
    expect(w.row('CANCELLED')).toMatchObject({ refundReason: 'SALE_CANCELLED' });
  });

  it('flags each capture once: a second pass, or one a day later, flags nothing again', async () => {
    const w = world();
    await held(w, 'ABANDONED', ago(DAY + 60_000));

    await expect(w.ledger.flagStaleHeld(NOW, 100)).resolves.toBe(1);
    await expect(w.ledger.flagStaleHeld(NOW, 100)).resolves.toBe(0);
    await expect(w.ledger.flagStaleHeld(new Date(NOW.getTime() + DAY), 100)).resolves.toBe(0);
    expect(w.row('ABANDONED')).toMatchObject({ refundFlaggedAt: NOW, refundReason: 'SALE_NOT_PAID' });
  });

  it("waits the window on the store's clock too, and flags a young sale once it is a window old", async () => {
    const w = world();
    await held(w, 'CLOCK-RESET', ago(2 * DAY));
    w.captures.setRecordedAt(TENANT, 'CLOCK-RESET', ago(60_000));
    await held(w, 'YOUNG-SALE', ago(2 * DAY), { saleAt: ago(60_000) });

    await expect(w.ledger.flagStaleHeld(NOW, 100)).resolves.toBe(0);
    await expect(w.ledger.flagStaleHeld(new Date(NOW.getTime() + DAY), 100)).resolves.toBe(2);
  });

  it('drains a backlog in ticks of `limit`, oldest first', async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) await held(w, `OLD-${i}`, ago(DAY + (3 - i) * 60_000));

    await expect(w.ledger.flagStaleHeld(NOW, 2)).resolves.toBe(2);
    expect(w.rows().filter((row) => row.refundFlaggedAt !== null).map((row) => row.transactionCode).sort()).toEqual(['OLD-0', 'OLD-1']);
    await expect(w.ledger.flagStaleHeld(NOW, 2)).resolves.toBe(1);
  });

  it('owes the money back for good: a settle that comes after the flag is refused, and nothing is cleared', async () => {
    const w = world();
    const sale = await held(w, 'ABANDONED', ago(DAY + 60_000));
    await w.ledger.flagStaleHeld(NOW, 100);

    expect((await refusal(w.ledger.bind(null, TENANT, ['ABANDONED'], sale))).code).toBe('FLAGGED');
    expect(w.row('ABANDONED')).toMatchObject({ state: 'ORDER_CREATED', refundReason: 'SALE_NOT_PAID', refundClearedAt: null });
  });

  it('never flags a capture a settle bound between the read and the write', async () => {
    const w = world();
    const sale = await held(w, 'SETTLED-MEANWHILE', ago(DAY + 60_000));
    // The host answered the sale unpaid, and the settle bound the capture right after.
    const racing: SaleDirectory = {
      ...w.sales,
      staleUnpaidSales: async (asked) => {
        await w.ledger.bind(null, TENANT, ['SETTLED-MEANWHILE'], sale);
        return asked;
      },
    };
    const ledger = createTerminalCaptureLedger({
      store: w.captures.storeFor,
      directory: w.directory,
      sales: racing,
      maxAmountCents: 100_000_000,
      unboundRefundAfterMs: DAY,
      now: () => NOW,
    });

    await expect(ledger.flagStaleHeld(NOW, 100)).resolves.toBe(0);
    expect(w.row('SETTLED-MEANWHILE')).toMatchObject({ state: 'BOUND', refundFlaggedAt: null });
  });

  it('flags nothing for a host that does not answer which sales are unpaid', async () => {
    const w = world();
    await held(w, 'ABANDONED', ago(2 * DAY));
    const older: SaleDirectory = { saleBelongs: w.sales.saleBelongs, paymentBelongs: w.sales.paymentBelongs };
    const ledger = createTerminalCaptureLedger({
      store: w.captures.storeFor,
      directory: w.directory,
      sales: older,
      maxAmountCents: 100_000_000,
      unboundRefundAfterMs: DAY,
      now: () => NOW,
    });

    await expect(ledger.flagStaleHeld(NOW, 100)).resolves.toBe(0);
    expect(w.row('ABANDONED')).toMatchObject({ refundFlaggedAt: null });
  });

  it('never flags a sale the host did not ask about, whatever it answers', async () => {
    const w = world();
    await held(w, 'ABANDONED', ago(2 * DAY));
    const strayAnswer: SaleDirectory = { ...w.sales, staleUnpaidSales: async () => [{ clientId: OTHER_TENANT, orderId: 'order-1' }] };
    const ledger = createTerminalCaptureLedger({
      store: w.captures.storeFor,
      directory: w.directory,
      sales: strayAnswer,
      maxAmountCents: 100_000_000,
      unboundRefundAfterMs: DAY,
      now: () => NOW,
    });

    await expect(ledger.flagStaleHeld(NOW, 100)).resolves.toBe(0);
  });
});
