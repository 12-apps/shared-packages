import { describe, expect, it, vi } from 'vitest';

import { admitExcess, capturedAbove, createCaptureExcess, planExcess, type ExcessPlan } from '../capture-excess';
import { actsHost } from './acts-host';
import { TENANT, capture, world } from './world';

/**
 * FUT-4996 (D7) State 5, on the memory store: captures above what the sale is
 * worth. The money cases of the host's contract suite (R21 CHANGE, R22
 * STORE_CREDIT, R23 EXCESS_NEEDS_BUYER, R25 CAPTURES_EXCEED_TOTAL) and R24's
 * refund-and-recharge, as the package's own tests, driven the way a caller
 * drives the caller-driven settle (`./acts-host`). The permission and PIN gate
 * stays the host's.
 */

const NOTE = 'manager: reason given';
/** The host's refund reason code for a reduced total. */
const REDUCED = 'CONTA_REDUCED';

function setup() {
  const made = world();
  const host = actsHost(made.captures);
  const excessEngine = createCaptureExcess({ ledger: made.ledger, credit: host.credit, refundReason: REDUCED });
  /** The settle as the caller drives it: one transaction, the engine's answer, the caller's own cash and audit. */
  const drivenExcess = {
    settle: (plan: ExcessPlan, sale: { clientId: string; orderId: string | null }, note: string) => host.settle(excessEngine, plan, sale, note),
    /** The caller's read of its buyer, then the pure admission. */
    admit: (plan: ExcessPlan, sale: { clientId: string; orderId: string | null }) => admitExcess(plan, { buyerHoldsCredit: host.buyerHoldsCredit(sale.orderId) }),
  };
  function sale(buyer: boolean) {
    const { orderId, paymentId } = made.sale();
    host.sales.set(orderId, { clientId: TENANT, paymentId, paid: true, legs: [], buyer });
    return orderId;
  }
  return { w: made, host, excess: drivenExcess, engine: excessEngine, sale };
}

describe('planExcess', () => {
  it('R25: captures above the due with no choice are refused CAPTURES_EXCEED_TOTAL, naming the excess', () => {
    expect(planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600 })).toEqual({
      kind: 'REFUSED',
      code: 'CAPTURES_EXCEED_TOTAL',
      excessCents: 3200,
    });
  });

  it('captures at or below the due fit, whatever the choice', () => {
    const captures = [
      { transactionCode: 'TC-1', amountCents: 2000 },
      { transactionCode: 'TC-2', amountCents: 2600 },
    ];
    expect(capturedAbove(captures, 4600)).toBe(0);
    expect(planExcess({ captures, dueCents: 4600, choice: { as: 'CHANGE', reason: 'r' } })).toEqual({ kind: 'FITS', excessCents: 0 });
    expect(planExcess({ captures: [], dueCents: 0 })).toEqual({ kind: 'FITS', excessCents: 0 });
  });

  it('R21: CHANGE keeps each capture leg at its captured amount and hands the excess back in cash', () => {
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600, choice: { as: 'CHANGE', reason: 'item removed' } });

    expect(plan).toEqual({ kind: 'CHANGE', excessCents: 3200, reason: 'item removed', legs: [{ transactionCode: 'TC-1', amountCents: 7800 }], cashRefundCents: 3200 });
  });

  it('R22: STORE_CREDIT credits exactly the excess', () => {
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600, choice: { as: 'STORE_CREDIT', reason: 'r' } });

    expect(plan).toMatchObject({ kind: 'STORE_CREDIT', excessCents: 3200, creditCents: 3200 });
  });

  it('R24: REFUND_AND_RECHARGE takes the latest captures off until the rest fit, and charges what is left', () => {
    const captures = [
      { transactionCode: 'TC-1', amountCents: 3000 },
      { transactionCode: 'TC-2', amountCents: 4800 },
    ];

    expect(planExcess({ captures, dueCents: 4600, choice: { as: 'REFUND_AND_RECHARGE', reason: 'CONTA_REDUCED' } })).toEqual({
      kind: 'REFUND_AND_RECHARGE',
      excessCents: 3200,
      reason: 'CONTA_REDUCED',
      kept: [{ transactionCode: 'TC-1', amountCents: 3000 }],
      refunded: [{ transactionCode: 'TC-2', amountCents: 4800 }],
      rechargeCents: 1600,
    });
    expect(planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 1200, choice: { as: 'REFUND_AND_RECHARGE', reason: 'x' } })).toMatchObject({
      kept: [],
      refunded: [{ transactionCode: 'TC-1', amountCents: 7800 }],
      rechargeCents: 1200,
    });
  });
});

describe('admit: the read before anything is written', () => {
  it('R25: a refused plan is CAPTURES_EXCEED_TOTAL with the excess', async () => {
    const { excess } = setup();
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600 });

    expect(await excess.admit(plan, { clientId: TENANT, orderId: null })).toEqual({ ok: false, code: 'CAPTURES_EXCEED_TOTAL', excessCents: 3200 });
  });

  it('R23: STORE_CREDIT with no identified buyer — a new sale, or a sale with none — is EXCESS_NEEDS_BUYER', async () => {
    const { excess, sale } = setup();
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 1500 }], dueCents: 1200, choice: { as: 'STORE_CREDIT', reason: 'r' } });

    expect(await excess.admit(plan, { clientId: TENANT, orderId: null })).toEqual({ ok: false, code: 'EXCESS_NEEDS_BUYER', excessCents: 300 });
    expect(await excess.admit(plan, { clientId: TENANT, orderId: sale(false) })).toEqual({ ok: false, code: 'EXCESS_NEEDS_BUYER', excessCents: 300 });
    expect(await excess.admit(plan, { clientId: TENANT, orderId: sale(true) })).toBeNull();
  });

  it('CHANGE and a fitting plan are admitted with no read of the buyer', async () => {
    const { excess } = setup();
    const change = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 1500 }], dueCents: 1200, choice: { as: 'CHANGE', reason: 'r' } });

    expect(await excess.admit(change, { clientId: TENANT, orderId: null })).toBeNull();
    expect(await excess.admit(planExcess({ captures: [], dueCents: 10 }), { clientId: TENANT, orderId: null })).toBeNull();
  });
});

describe('settle: booking the excess on the written sale', () => {
  it('R21: CHANGE books the excess as cash handed back and records it, with no credit', async () => {
    const { host, excess, sale } = setup();
    const orderId = sale(false);
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600, choice: { as: 'CHANGE', reason: 'item removed' } });

    expect(await excess.settle(plan, { clientId: TENANT, orderId }, NOTE)).toEqual({ ok: true, plan, cashRefundCents: 3200, creditCents: 0, rechargeCents: 0, record: { clientId: TENANT, orderId, as: 'CHANGE', excessCents: 3200, reason: 'item removed' } });
    expect(host.cashRefunds).toEqual([{ clientId: TENANT, orderId, amountCents: 3200 }]);
    expect(host.credits).toEqual([]);
    expect(host.records).toEqual([{ act: { clientId: TENANT, orderId, as: 'CHANGE', excessCents: 3200, reason: 'item removed' }, note: NOTE }]);
  });

  it('R22: STORE_CREDIT posts exactly the excess to the buyer and books no cash', async () => {
    const { host, excess, sale } = setup();
    const orderId = sale(true);
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600, choice: { as: 'STORE_CREDIT', reason: 'kept' } });

    expect(await excess.settle(plan, { clientId: TENANT, orderId }, NOTE)).toMatchObject({ ok: true });
    expect(host.credits).toEqual([{ clientId: TENANT, orderId, amountCents: 3200, reason: 'kept' }]);
    expect(host.cashRefunds).toEqual([]);
  });

  it("R24: REFUND_AND_RECHARGE flags the overshooting capture with the host's reason CODE, never the operator's free text, and returns what to charge again", async () => {
    const { w, host, excess } = setup();
    await w.ledger.record(capture({ transactionCode: 'TC-OLD', amountCents: 7800 }));
    const plan = planExcess({ captures: [{ transactionCode: 'TC-OLD', amountCents: 7800 }], dueCents: 1200, choice: { as: 'REFUND_AND_RECHARGE', reason: 'item taken off the bill' } });

    expect(await excess.settle(plan, { clientId: TENANT, orderId: null }, NOTE)).toMatchObject({ ok: true, rechargeCents: 1200 });
    expect(w.row('TC-OLD')).toMatchObject({ state: 'UNBOUND', refundReason: REDUCED, orderId: null });
    expect([host.cashRefunds, host.credits]).toEqual([[], []]);
    expect(host.records).toEqual([
      { act: { clientId: TENANT, orderId: null, as: 'REFUND_AND_RECHARGE', excessCents: 6600, reason: 'item taken off the bill' }, note: NOTE },
    ]);
  });

  it('the credit port gets the caller note, so the wallet can write who acted; the caller books its own cash', async () => {
    const { host, excess, sale } = setup();
    const refund = vi.spyOn(host.writes, 'bookCashRefund');
    const credit = vi.spyOn(host.credit, 'post');
    const change = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 1500 }], dueCents: 1200, choice: { as: 'CHANGE', reason: 'r' } });
    const kept = planExcess({ captures: [{ transactionCode: 'TC-2', amountCents: 1500 }], dueCents: 1200, choice: { as: 'STORE_CREDIT', reason: 'r' } });

    await excess.settle(change, { clientId: TENANT, orderId: sale(false) }, NOTE);
    await excess.settle(kept, { clientId: TENANT, orderId: sale(true) }, NOTE);

    expect(refund.mock.calls.map((call) => call[1])).toEqual([NOTE]);
    expect(credit.mock.calls.map((call) => call[1])).toEqual([NOTE]);
  });

  it('REFUND_AND_RECHARGE of a code the tenant does not hold is NOT_FOUND, and nothing is recorded', async () => {
    const { host, excess } = setup();
    const plan = planExcess({ captures: [{ transactionCode: 'TC-NONE', amountCents: 500 }], dueCents: 100, choice: { as: 'REFUND_AND_RECHARGE', reason: 'r' } });

    expect(await excess.settle(plan, { clientId: TENANT, orderId: null }, NOTE)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(host.records).toEqual([]);
  });

  it('a fitting plan books nothing; a refused one, or CHANGE with no sale, is a programming error', async () => {
    const { host, excess } = setup();
    const fits = planExcess({ captures: [], dueCents: 10 });
    const refused = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 50 }], dueCents: 10 });
    const change = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 50 }], dueCents: 10, choice: { as: 'CHANGE', reason: 'r' } });

    expect(await excess.settle(fits, { clientId: TENANT, orderId: 'order-x' }, NOTE)).toEqual({ ok: true, plan: fits, cashRefundCents: 0, creditCents: 0, rechargeCents: 0, record: null });
    await expect(excess.settle(refused, { clientId: TENANT, orderId: 'order-x' }, NOTE)).rejects.toThrow('admit it first');
    await expect(excess.settle(change, { clientId: TENANT, orderId: null }, NOTE)).rejects.toThrow('written sale');
    expect(host.records).toEqual([]);
  });
});

describe('caller-driven: settle writes payment state only', () => {
  it("CHANGE answers the cash to hand back and the record, and books nothing of the caller's", async () => {
    const { w, host, engine, sale } = setup();
    const orderId = sale(false);
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 7800 }], dueCents: 4600, choice: { as: 'CHANGE', reason: 'r' } });

    expect(await engine.settle(plan, { clientId: TENANT, orderId })).toMatchObject({ ok: true, cashRefundCents: 3200, rechargeCents: 0, record: { as: 'CHANGE', orderId } });
    expect([host.cashRefunds, host.records, w.rows()]).toEqual([[], [], []]);
  });

  it('REFUND_AND_RECHARGE flags on the caller transaction: a caller that throws after it rolls the flag back', async () => {
    const { w, host, engine } = setup();
    await w.ledger.record(capture({ transactionCode: 'TC-OLD', amountCents: 7800 }));
    const plan = planExcess({ captures: [{ transactionCode: 'TC-OLD', amountCents: 7800 }], dueCents: 1200, choice: { as: 'REFUND_AND_RECHARGE', reason: 'r' } });

    await expect(
      w.captures.transaction(async () => {
        await engine.settle(plan, { clientId: TENANT, orderId: null }, { tx: undefined });
        throw new Error('the caller failed its own write');
      }),
    ).rejects.toThrow('own write');
    expect(w.row('TC-OLD').refundFlaggedAt).toBeNull();
    expect(host.records).toEqual([]);
  });

  it('STORE_CREDIT with no credit port configured is a programming error, and nothing is posted', async () => {
    const { w, sale } = setup();
    const bare = createCaptureExcess({ ledger: w.ledger, refundReason: REDUCED });
    const plan = planExcess({ captures: [{ transactionCode: 'TC-1', amountCents: 1500 }], dueCents: 1200, choice: { as: 'STORE_CREDIT', reason: 'r' } });

    await expect(bare.settle(plan, { clientId: TENANT, orderId: sale(true) })).rejects.toThrow('credit port');
  });
});
