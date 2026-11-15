import { describe, expect, it, vi } from 'vitest';

import { createCaptureActs, planRebind } from '../capture-acts';
import { createTerminalLegs } from '../legs';
import type { TerminalCaptureStore } from '../ports';
import { actsHost } from './acts-host';
import { NOW, TENANT, OTHER_TENANT, capture, wire, world, type World } from './world';

/**
 * FUT-4996 (D7), State 4 and the refund of State 5, on the memory store: the
 * money cases of the host's contract suite (R08, R09, R24, R49) and R43's
 * CONTENDED, as the package's own tests, driven the way a caller drives the
 * caller-driven acts (`./acts-host`). The permission, PIN and reason gate (R10)
 * is the host's and stays there.
 */

const DRINK_CENTS = 1200;
const NOTE = 'manager: reason given';

function setup(options: { wrap?: (store: TerminalCaptureStore) => TerminalCaptureStore } = {}) {
  const made: World = world(options);
  const host = actsHost(made.captures);
  const legs = createTerminalLegs({ ledger: made.ledger, directory: made.directory, now: () => NOW });
  const actsEngine = createCaptureActs({ ledger: made.ledger, legs });
  /** The acts as the caller drives them: one transaction, the engine's answer, the caller's own writes. */
  const drivenActs = {
    refund: (input: Parameters<typeof host.refund>[1], note: string) => host.refund(actsEngine, input, note),
    rebind: (input: Parameters<typeof host.rebind>[1], note: string) => host.rebind(actsEngine, input, note),
  };
  /** A sale paid in cash and its payment row, as the host settled it. */
  function cashSale(cents = DRINK_CENTS, clientId = TENANT) {
    const sale = made.sale(clientId);
    host.sales.set(sale.orderId, { clientId, paymentId: sale.paymentId, paid: true, legs: [{ tender: 'CASH', amountCents: cents }], buyer: false });
    return sale;
  }
  return { w: made, host, acts: drivenActs, engine: actsEngine, cashSale };
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

    expect([first, again]).toEqual([{ ok: true, flagged: true, record: expect.objectContaining({ act: 'REFUND' }) }, { ok: true, flagged: false }]);
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
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toMatchObject({ ok: true, moved: true });

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

    expect(await acts.refund({ clientId: TENANT, transactionCode: 'TC-OLD', refundReason: 'CONTA_REDUCED' }, NOTE)).toMatchObject({ ok: true, flagged: true });
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

    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toEqual({ ok: true, moved: true, legs: [{ tender: 'CREDIT', amountCents: DRINK_CENTS }], cashBackCents: DRINK_CENTS, record: { act: 'REBIND', clientId: TENANT, transactionCode: 'TC-1', kind: 'CREDIT', amountCents: DRINK_CENTS, orderId } });

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
    const bookCashBack = vi.spyOn(host.writes, 'bookCashBack');

    const first = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE);
    const again = await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE);

    expect([first, again]).toEqual([expect.objectContaining({ ok: true, moved: true }), { ok: true, moved: false }]);
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: 7000 }, { tender: 'CREDIT', amountCents: 3000 }]);
    expect(host.cashBack).toEqual([{ clientId: TENANT, orderId, amountCents: 3000, transactionCode: 'TC-1' }]);
    expect(host.records).toHaveLength(1);
    expect(bookCashBack.mock.calls.map((call) => call[1])).toEqual([NOTE]);
  });

  it('B1 under concurrency: two rebinds at once both read the capture UNBOUND, and only the one that moved it writes', async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale(10_000);
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: 3000 }));

    const answers = await Promise.all([1, 2].map(() => acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)));

    expect(answers).toEqual(expect.arrayContaining([expect.objectContaining({ ok: true, moved: true }), { ok: true, moved: false }]));
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: 7000 }, { tender: 'CREDIT', amountCents: 3000 }]);
    expect(host.cashBack.map((cash) => cash.amountCents)).toEqual([3000]);
    expect(host.records).toHaveLength(1);
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

  it("R09: a sale that is not a settled sale of this tenant is refused by the caller before any act; an unknown code is NOT_FOUND", async () => {
    const { w, acts, cashSale } = setup();
    const theirs = cashSale(DRINK_CENTS, OTHER_TENANT);
    const ours = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));

    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId: theirs.orderId }, NOTE)).toEqual({ ok: false, code: 'NOT_A_SETTLED_SALE' });
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-NONE', orderId: ours.orderId }, NOTE)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(w.row('TC-1').state).toBe('UNBOUND');
  });

  it('a capture another sale holds is BOUND_ELSEWHERE, and the sale keeps its cash', async () => {
    const { w, host, acts, cashSale } = setup();
    const first = cashSale();
    const second = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId: first.orderId }, NOTE)).toMatchObject({ ok: true, moved: true });

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
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toMatchObject({ ok: true, moved: true });
  });

  it('a caller write that fails mid-act rolls the bind back with it and is thrown, not answered', async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    vi.spyOn(host.writes, 'bookCashBack').mockRejectedValueOnce(new Error('drawer is closed'));

    await expect(acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).rejects.toThrow('drawer is closed');
    expect(w.row('TC-1').state).toBe('UNBOUND');
    expect(host.sales.get(orderId)?.legs).toEqual([{ tender: 'CASH', amountCents: DRINK_CENTS }]);
  });
});

describe('caller-driven: the engine writes payment state only', () => {
  it("rebind answers the legs and the cash back from the legs the caller passed, binds the capture, and touches none of the caller's records", async () => {
    const { w, host, engine, cashSale } = setup();
    const { orderId, paymentId } = cashSale(5000);
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: 2000 }));
    const legs = [{ tender: 'PIX', amountCents: 1000 }, { tender: 'CASH', amountCents: 4000 }];

    const outcome = await engine.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId, paymentId, legs }, undefined);

    expect(outcome).toEqual({
      ok: true,
      moved: true,
      legs: [{ tender: 'PIX', amountCents: 1000 }, { tender: 'CASH', amountCents: 2000 }, { tender: 'CREDIT', amountCents: 2000 }],
      cashBackCents: 2000,
      record: { act: 'REBIND', clientId: TENANT, transactionCode: 'TC-1', kind: 'CREDIT', amountCents: 2000, orderId },
    });
    expect(legs).toEqual([{ tender: 'PIX', amountCents: 1000 }, { tender: 'CASH', amountCents: 4000 }]);
    expect(w.row('TC-1')).toMatchObject({ state: 'BOUND', orderId, paymentId });
    expect([host.sales.get(orderId)?.legs, host.cashBack, host.records]).toEqual([[{ tender: 'CASH', amountCents: 5000 }], [], []]);
  });

  it("rebind onto a payment row that is not the tenant's sale's is refused by the ledger, nothing bound", async () => {
    const { w, engine, cashSale } = setup();
    const ours = cashSale();
    const theirs = cashSale(DRINK_CENTS, OTHER_TENANT);
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));

    const outcome = await engine.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId: ours.orderId, paymentId: theirs.paymentId, legs: [{ tender: 'CASH', amountCents: DRINK_CENTS }] }, undefined);

    expect(outcome.ok).toBe(false);
    expect(w.row('TC-1').state).toBe('UNBOUND');
  });

  it('refund flags the capture and answers the record; the caller writes the audit, the engine does not', async () => {
    const { w, host, engine } = setup();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));

    const outcome = await engine.refund({ clientId: TENANT, transactionCode: 'TC-1', refundReason: 'RECEIVED_TWICE' });

    expect(outcome).toEqual({ ok: true, flagged: true, record: { act: 'REFUND', clientId: TENANT, transactionCode: 'TC-1', refundReason: 'RECEIVED_TWICE' } });
    expect(w.row('TC-1').refundReason).toBe('RECEIVED_TWICE');
    expect(host.records).toEqual([]);
  });

  it("a caller write that fails after the bind rolls the bind back with the caller's transaction", async () => {
    const { w, host, acts, cashSale } = setup();
    const { orderId } = cashSale();
    await w.ledger.record(capture({ transactionCode: 'TC-1', amountCents: DRINK_CENTS }));
    vi.spyOn(host.writes, 'record').mockRejectedValueOnce(new Error('audit down'));

    await expect(acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).rejects.toThrow('audit down');
    expect(w.row('TC-1').state).toBe('UNBOUND');
    expect([host.sales.get(orderId)?.legs, host.cashBack]).toEqual([[{ tender: 'CASH', amountCents: DRINK_CENTS }], []]);
    expect(await acts.rebind({ clientId: TENANT, transactionCode: 'TC-1', orderId }, NOTE)).toMatchObject({ ok: true, moved: true });
  });
});
