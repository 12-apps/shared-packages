import { describe, expect, it, vi } from 'vitest';

import { createCaptureActs, planRebind } from '../capture-acts';
import { createTerminalLegs } from '../legs';
import type { TerminalCaptureStore } from '../ports';
import { actsHost } from './acts-host';
import { NOW, TENANT, OTHER_TENANT, capture, wire, world, type World } from './world';

/**
 * FUT-4996 (D7), State 4 and the refund of State 5, on the memory store: the
 * money cases of the host's contract suite `terminal-capture-caixa-acts`
 * (R08, R09, R24, R49) and R43's CONTENDED, as the package's own tests. The
 * permission, PIN and reason gate (R10) is the host's and stays there.
 */

const DRINK_CENTS = 1200;
const NOTE = 'manager: reason given';

function setup(options: { wrap?: (store: TerminalCaptureStore) => TerminalCaptureStore } = {}) {
  const made: World = world(options);
  const host = actsHost(made.captures);
  const legs = createTerminalLegs({ ledger: made.ledger, directory: made.directory, now: () => NOW });
  const engine = createCaptureActs({ ledger: made.ledger, legs, ports: host.acts });
  /** A sale paid in cash and its payment row, as the host settled it. */
  function cashSale(cents = DRINK_CENTS, clientId = TENANT) {
    const sale = made.sale(clientId);
    host.sales.set(sale.orderId, { clientId, paymentId: sale.paymentId, paid: true, legs: [{ tender: 'CASH', amountCents: cents }], buyer: false });
    return sale;
  }
  return { w: made, host, acts: engine, cashSale };
}

describe('planRebind', () => {
  it('moves the amount off the first cash leg large enough, drops it when nothing is left, and keeps the other legs as they are', () => {
    const legs = [
      { tender: 'PIX', amountCents: 500, note: 'kept' },
      { tender: 'CASH', amountCents: 300 },
      { tender: 'CASH', amountCents: 2000 },
    ];

    expect(planRebind(legs, { kind: 'DEBIT', amountCents: 1200 })).toEqual({
      legs: [{ tender: 'PIX', amountCents: 500, note: 'kept' }, { tender: 'CASH', amountCents: 300 }, { tender: 'CASH', amountCents: 800 }, { tender: 'DEBIT', amountCents: 1200 }],
      cashBackCents: 1200,
    });
    expect(planRebind([{ tender: 'CASH', amountCents: 1200 }], { kind: 'CREDIT', amountCents: 1200 })?.legs).toEqual([{ tender: 'CREDIT', amountCents: 1200 }]);
  });

  it('is null when no cash leg is that large; a host may name its own cash tender', () => {
    expect(planRebind([{ tender: 'CASH', amountCents: 1000 }], { kind: 'CREDIT', amountCents: 1200 })).toBeNull();
    expect(planRebind([{ tender: 'MONEY', amountCents: 1200 }], { kind: 'CREDIT', amountCents: 1200 }, 'MONEY')?.cashBackCents).toBe(1200);
  });
});

describe('State 4: received twice — refund', () => {
  it("R08: records the station's capture, flags it RECEIVED_TWICE once and records the act once; the cash sale is untouched", async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale();
    const late = wire({ transactionCode: 'TC-LATE', amountCents: DRINK_CENTS });

    const first = await acts.refund({ clientId: TENANT, transactionCode: 'TC-LATE', refundReason: 'RECEIVED_TWICE', capture: late, orderId }, NOTE);
    const again = await acts.refund({ clientId: TENANT, transactionCode: 'TC-LATE', refundReason: 'RECEIVED_TWICE', capture: late, orderId }, NOTE);

    expect([first, again]).toEqual([{ ok: true }, { ok: true }]);
    expect(w.row('TC-LATE')).toMatchObject({ state: 'UNBOUND', source: 'STATION', refundReason: 'RECEIVED_TWICE', refundFlaggedAt: NOW, orderId: null });
    expect(host.records).toEqual([{ act: { act: 'REFUND', clientId: TENANT, transactionCode: 'TC-LATE', refundReason: 'RECEIVED_TWICE', orderId }, note: NOTE }]);
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: DRINK_CENTS }]);
  });

  it('R08: a station report that contradicts the recorded capture is CONFLICT, nothing flagged', async () => {
    const { w, host, acts } = setup();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: 4750 }));

    const answer = await acts.refund({ clientId: TENANT, transactionCode: 'TC-1', refundReason: 'RECEIVED_TWICE', capture: wire({ transactionCode: 'TC-1', amountCents: 1200 }) }, NOTE);

    expect(answer).toEqual({ ok: false, code: 'CONFLICT' });
    expect(w.row('TC-1').refundFlaggedAt).toBeNull();
    expect(host.records).toEqual([]);
  });

  it('a code the tenant does not hold is NOT_FOUND, and another tenant never reaches it', async () => {
    const { w, acts } = setup();
    await w.ledger.record(capture({ clientId: OTHER_TENANT, transactionCode: 'TC-B' }));

    expect(await acts.refund({ clientId: TENANT, transactionCode: 'TC-B', refundReason: 'RECEIVED_TWICE' }, NOTE)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(w.row('TC-B', OTHER_TENANT).refundFlaggedAt).toBeNull();
  });

  it("R49: RECEIVED_TWICE on a capture a sale already holds is BOUND_ELSEWHERE, nothing written — the money is the sale's or owed back, never both", async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toEqual({ ok: true });

    const answer = await acts.refund({ clientId: TENANT, transactionCode: 'TC-1', refundReason: 'RECEIVED_TWICE', orderId }, NOTE);

    expect(answer).toEqual({ ok: false, code: 'BOUND_ELSEWHERE' });
    expect(w.row('TC-1')).toMatchObject({ state: 'BOUND', refundFlaggedAt: null });
    expect(host.records.map((row) => row.act)).toEqual([expect.objectContaining({ act: 'REBIND' })]);
  });
});

describe("State 5: refund and charge again — the host's own reason", () => {
  it('R24: a host reason (CONTA_REDUCED) flags the old capture once, and it binds nowhere after', async () => {
    const { w, host, acts, cashSale } = setup();
    await w.ledger.record(capture({ transactionCode: 'TC-OLD', amountCents: 7800 }));

    expect(await acts.refund({ clientId: TENANT, transactionCode: 'TC-OLD', refundReason: 'CONTA_REDUCED' }, NOTE)).toEqual({ ok: true });
    const { orderId } = cashSale(7800);

    expect(w.row('TC-OLD')).toMatchObject({ state: 'UNBOUND', refundReason: 'CONTA_REDUCED' });
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-OLD', orderId }, NOTE)).toEqual({ ok: false, code: 'FLAGGED' });
    expect(host.records).toHaveLength(1);
  });
});

describe('State 4: received twice — pay the leg with the capture instead of cash', () => {
  it('R09: the cash leg becomes the captured kind, the capture binds to the payment row, and the cash goes back, in one act', async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId, paymentId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));

    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toEqual({ ok: true });

    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CREDIT', amountCents: DRINK_CENTS }]);
    expect(w.row('TC-1')).toMatchObject({ state: 'BOUND', orderId, paymentId, refundFlaggedAt: null });
    expect(host.cashBack).toEqual([{ clientId: TENANT, orderId, amountCents: DRINK_CENTS, transactionCode: 'TC-1' }]);
    expect(host.records).toEqual([
      { act: { act: 'REBIND', clientId: TENANT, transactionCode: 'TC-1', kind: 'CREDIT', amountCents: DRINK_CENTS, orderId }, note: NOTE },
    ]);
  });

  it('B1: a repeated rebind of a capture already bound to that sale answers ok and moves no leg, books no cash and records nothing more', async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale(10_000);
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: 3000 }));
    const bookCashBack = vi.spyOn(host.acts, 'bookCashBack');

    const first = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE);
    const again = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE);

    expect([first, again]).toEqual([{ ok: true }, { ok: true }]);
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: 7000 }, { tender: 'CREDIT', amountCents: 3000 }]);
    expect(host.cashBack).toEqual([{ clientId: TENANT, orderId, amountCents: 3000, transactionCode: 'TC-1' }]);
    expect(host.records).toHaveLength(1);
    expect(bookCashBack.mock.calls.map((call) => call[2])).toEqual([NOTE]);
  });

  it('R09: refused with nothing written when the sale has no cash leg that large, or the capture is owed back', async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-BIG', amountCents: DRINK_CENTS * 3 }));
    await w.ledger.record(capture({ transactionCode: 'TC-OWED', amountCents: DRINK_CENTS }));
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-OWED' }, 'SALE_NOT_CREATED');

    const big = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-BIG', orderId }, NOTE);
    const owed = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-OWED', orderId }, NOTE);

    expect([big, owed]).toEqual([
      { ok: false, code: 'NO_CASH_LEG' },
      { ok: false, code: 'FLAGGED' },
    ]);
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: DRINK_CENTS }]);
    expect([host.cashBack, host.records]).toEqual([[], []]);
    expect(w.rows().filter((row) => row.state === 'BOUND')).toEqual([]);
  });

  it("R09: a sale that is not a settled sale of this tenant is NO_CASH_LEG; an unknown code is NOT_FOUND", async () => {
    const { w, acts, cashSale } = setup();
    const theirs = cashSale(DRINK_CENTS, OTHER_TENANT);
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));

    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId: theirs.orderId }, NOTE)).toEqual({ ok: false, code: 'NO_CASH_LEG' });
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-NONE', orderId: theirs.orderId }, NOTE)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(w.row('TC-1').state).toBe('UNBOUND');
  });

  it('a capture another sale holds is BOUND_ELSEWHERE, and the sale keeps its cash', async () => {
    const { w, host, acts, cashSale } = setup();
    const first = cashSale();
    const second = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId: first.orderId }, NOTE)).toEqual({ ok: true });

    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId: second.orderId }, NOTE)).toEqual({ ok: false, code: 'BOUND_ELSEWHERE' });
    expect(host.sales.get(second.orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: DRINK_CENTS }]);
    expect(host.cashBack).toHaveLength(1);
  });
});

describe('R43: CONTENDED is not another sale\'s', () => {
  it('a rebind whose compare-and-set keeps losing answers CONTENDED with nothing written, and the same act again lands', async () => {
    const write = vi.fn<TerminalCaptureStore['writeIfUnchanged']>();
    const { w, host, acts, cashSale } = setup({
      wrap: (store) => {
        write.mockImplementation((seen, patch) => store.writeIfUnchanged(seen, patch));
        return { ...store, writeIfUnchanged: write };
      },
    });
    const { orderId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    for (let lost = 0; lost < 4; lost += 1) write.mockResolvedValueOnce(false);

    const first = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE);

    expect(first).toEqual({ ok: false, code: 'CONTENDED' });
    expect(w.row('TC-1').state).toBe('UNBOUND');
    expect([host.sales.get(orderId)?.legs, host.cashBack, host.records]).toEqual([[{ tender: 'CASH', amountCents: DRINK_CENTS }], [], []]);
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toEqual({ ok: true });
  });

  it('a port that fails mid-act rolls the bind back with it and is thrown, not answered', async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    vi.spyOn(host.acts, 'bookCashBack').mockRejectedValueOnce(new Error('drawer is closed'));

    await expect(acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).rejects.toThrow('drawer is closed');
    expect(w.row('TC-1').state).toBe('UNBOUND');
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: DRINK_CENTS }]);
  });
});
