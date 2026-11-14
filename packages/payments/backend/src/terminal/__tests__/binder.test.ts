import { describe, expect, it } from 'vitest';

import { createNonRefusingCaptureBinder, type SaleCapture } from '../binder';
import { createTerminalLegs } from '../legs';
import type { Savepoint } from '../ports';
import { NOW, OTHER_TENANT, TENANT, wire, world, type World } from './world';

/**
 * The non-refusing binder against the in-memory store. Ported from the origin
 * host's offline-sync suite: every capture is recorded before the sale's
 * transaction, bound inside it under its own savepoint, and one that cannot
 * bind is answered with why and left exactly as it was — never the reason the
 * sale is refused.
 */

const SOLD_AT = '2026-11-03T14:30:00.000Z';

function binderOf(w: World, savepoint: Savepoint = w.captures.savepoint) {
  const legs = createTerminalLegs({ ledger: w.ledger, directory: w.directory, now: () => NOW });
  return createNonRefusingCaptureBinder({ ledger: w.ledger, legs, savepoint, now: () => NOW });
}

const traced = (code: string, overrides: Partial<ReturnType<typeof wire>> = {}): SaleCapture => ({
  code,
  wire: wire({ transactionCode: code, ...overrides }),
});
const kept = (code: string, tender = 'DEBIT', amountCents = 2500): SaleCapture => ({ code, leg: { tender, amountCents } });

/** Step 1 then step 2, as a sync books one sale. */
async function book(w: World, captures: SaleCapture[]) {
  const subject = binderOf(w);
  const target = w.sale();
  const notBound = await subject.recordEach(TENANT, captures, SOLD_AT);
  const missed = await w.captures.transaction(() => subject.bindEach(null, TENANT, captures, SOLD_AT, target, notBound));
  return { target, missed };
}

const terminalReports = (w: World, code: string, overrides: Partial<ReturnType<typeof wire>> = {}) =>
  w.ledger.record({ ...wire({ transactionCode: code, ...overrides }), clientId: TENANT, source: 'DEVICE', capturedAt: NOW });

describe("a sale's terminal capture at its booking", () => {
  it('records the capture and binds it to the sale’s one payment row, with its trace', async () => {
    const w = world();
    const { target, missed } = await book(w, [traced('T1')]);

    expect(missed).toEqual([]);
    expect(w.row('T1')).toMatchObject({ state: 'BOUND', orderId: target.orderId, paymentId: target.paymentId, source: 'STATION', transactionId: 'TID-0001' });
  });

  it('binds the record the terminal reported first — that same record, nothing recorded twice', async () => {
    const w = world();
    await terminalReports(w, 'T1');
    const reported = w.row('T1');

    const { target } = await book(w, [traced('T1')]);

    expect(w.rows()).toEqual([expect.objectContaining({ id: reported.id, source: 'DEVICE', state: 'BOUND', paymentId: target.paymentId })]);
  });

  it('books a sale whose capture is flagged, answering why and leaving it as it was, while the other leg binds', async () => {
    const w = world();
    await terminalReports(w, 'FLAGGED');
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'FLAGGED' }, 'SALE_NOT_CREATED', NOW);
    const before = w.row('FLAGGED');

    const { target, missed } = await book(w, [traced('FLAGGED'), traced('FRESH', { kind: 'PIX' })]);

    expect(missed).toEqual([{ transactionCode: 'FLAGGED', reason: 'FLAGGED' }]);
    expect(w.row('FLAGGED')).toEqual(before);
    expect(w.row('FRESH')).toMatchObject({ state: 'BOUND', orderId: target.orderId });
  });

  it('books a sale whose capture another sale holds, never moving the capture to it', async () => {
    const w = world();
    const first = await book(w, [traced('T1')]);
    const held = w.row('T1');

    const { missed } = await book(w, [traced('T1')]);

    expect(missed).toEqual([{ transactionCode: 'T1', reason: 'BOUND_ELSEWHERE' }]);
    expect(w.row('T1')).toEqual(held);
    expect(held).toMatchObject({ orderId: first.target.orderId });
  });

  it('books a sale whose capture was recorded with another amount, the record untouched', async () => {
    const w = world();
    await terminalReports(w, 'T1', { amountCents: 999 });

    const { missed } = await book(w, [traced('T1')]);

    expect(missed).toEqual([{ transactionCode: 'T1', reason: 'CONFLICT' }]);
    expect(w.row('T1')).toMatchObject({ state: 'UNBOUND', amountCents: 999, orderId: null });
  });

  it("books a sale naming another tenant's terminal, answering why and recording no capture", async () => {
    const w = world();
    const { missed } = await book(w, [traced('T1', { deviceId: w.device(OTHER_TENANT) })]);

    expect(missed).toEqual([{ transactionCode: 'T1', reason: 'DEVICE_UNKNOWN' }]);
    expect(w.rows()).toHaveLength(0);
  });

  it("binds its own tenant's record under a code another tenant also holds, never the other's", async () => {
    const w = world();
    await w.ledger.record({ clientId: OTHER_TENANT, source: 'DEVICE', transactionCode: 'T1', kind: 'CREDIT', amountCents: 999, capturedAt: NOW });
    const theirs = w.row('T1', OTHER_TENANT);

    const { missed, target } = await book(w, [traced('T1')]);

    expect(missed).toEqual([]);
    expect(w.row('T1')).toMatchObject({ state: 'BOUND', orderId: target.orderId });
    expect(w.row('T1', OTHER_TENANT)).toEqual(theirs);
  });

  it('binds a capture the sweep flagged, its sale arriving late, and clears the flag', async () => {
    const w = world();
    await terminalReports(w, 'T1');
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'T1' }, 'UNBOUND_TIMEOUT', NOW);

    const { missed, target } = await book(w, [traced('T1')]);

    expect(missed).toEqual([]);
    expect(w.row('T1')).toMatchObject({ state: 'BOUND', orderId: target.orderId, refundClearedAt: NOW });
  });

  it('answers nothing for a sale with no capture', async () => {
    const w = world();
    await expect(book(w, [])).resolves.toMatchObject({ missed: [] });
  });
});

describe('a leg kept by its code alone (the trace lost)', () => {
  it('records the capture from the leg, source JOURNAL, dated by the sale, binds it, and takes the trace when the terminal reports it', async () => {
    const w = world();
    const { target } = await book(w, [kept('T1')]);

    expect(w.row('T1')).toMatchObject({ state: 'BOUND', orderId: target.orderId, source: 'JOURNAL', kind: 'DEBIT', amountCents: 2500, transactionId: null, capturedAt: new Date(SOLD_AT) });

    await terminalReports(w, 'T1', { kind: 'DEBIT', terminalSerial: 'PAX-0001' });

    expect(w.row('T1')).toMatchObject({ state: 'BOUND', source: 'JOURNAL', transactionId: 'TID-0001', terminalSerial: 'PAX-0001' });
  });

  it('dates a leg sold in the future at now', async () => {
    const w = world();
    const binder = binderOf(w);
    await binder.recordEach(TENANT, [kept('T1')], '2026-12-01T00:00:00.000Z');
    expect(w.row('T1').capturedAt).toEqual(NOW);
  });

  it('binds the record the terminal reported first', async () => {
    const w = world();
    await terminalReports(w, 'T1', { kind: 'PIX' });
    const reported = w.row('T1');

    const { target } = await book(w, [kept('T1', 'PIX')]);

    expect(w.row('T1')).toMatchObject({ id: reported.id, source: 'DEVICE', state: 'BOUND', orderId: target.orderId, transactionId: 'TID-0001' });
  });

  it('answers a kept leg the record contradicts as CONFLICT and binds nothing', async () => {
    const w = world();
    await terminalReports(w, 'T1', { kind: 'CREDIT' });

    const { missed } = await book(w, [kept('T1', 'DEBIT')]);

    expect(missed).toEqual([{ transactionCode: 'T1', reason: 'CONFLICT' }]);
    expect(w.row('T1')).toMatchObject({ state: 'UNBOUND' });
  });
});

describe('the savepoint per capture', () => {
  it('rolls back only the capture that will not bind; the rest of the sale’s writes stand', async () => {
    const w = world();
    const binder = binderOf(w);
    const target = w.sale();
    const other = w.sale();
    // Recorded fine before the transaction, then taken by another sale before the bind.
    const captures = [traced('OK'), traced('TAKEN')];
    const notBound = await binder.recordEach(TENANT, captures, SOLD_AT);
    await w.ledger.markSaleCreated(null, { clientId: TENANT, transactionCode: 'TAKEN' }, other.orderId);

    const missed = await binder.bindEach(null, TENANT, captures, SOLD_AT, target, notBound);

    expect(missed).toEqual([{ transactionCode: 'TAKEN', reason: 'BOUND_ELSEWHERE' }]);
    expect(w.row('OK')).toMatchObject({ state: 'BOUND', paymentId: target.paymentId });
    expect(w.row('TAKEN')).toMatchObject({ state: 'ORDER_CREATED', orderId: other.orderId });
  });

  it('opens, then releases or rolls back to, one savepoint per capture it tries; none for a known refusal', async () => {
    const w = world();
    const calls: string[] = [];
    const savepoint: Savepoint = {
      open: async (tx) => void calls.push(`open:${String(tx)}`, ...(await w.captures.savepoint.open(tx).then(() => []))),
      release: async (tx) => void calls.push('release', ...(await w.captures.savepoint.release(tx).then(() => []))),
      rollBack: async (tx) => void calls.push('rollBack', ...(await w.captures.savepoint.rollBack(tx).then(() => []))),
    };
    const binder = binderOf(w, savepoint);
    const target = w.sale();
    await terminalReports(w, 'CONFLICTED', { amountCents: 1 });
    const captures = [traced('GOOD'), traced('CONFLICTED'), traced('LATE')];
    const notBound = await binder.recordEach(TENANT, captures, SOLD_AT);
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'LATE' }, 'SALE_CANCELLED', NOW);

    const missed = await binder.bindEach('tx-1', TENANT, captures, SOLD_AT, target, notBound);

    expect(missed).toEqual([
      { transactionCode: 'CONFLICTED', reason: 'CONFLICT' },
      { transactionCode: 'LATE', reason: 'FLAGGED' },
    ]);
    expect(calls).toEqual(['open:tx-1', 'release', 'open:tx-1', 'rollBack']);
  });

  it('lets an error that is not a capture refusal through, without rolling back to the savepoint', async () => {
    const w = world();
    const calls: string[] = [];
    const savepoint: Savepoint = {
      open: async () => void calls.push('open'),
      release: async () => void calls.push('release'),
      rollBack: async () => void calls.push('rollBack'),
    };
    const legs = createTerminalLegs({ ledger: w.ledger, directory: w.directory });
    const broken = { ...w.ledger, bind: () => Promise.reject(new Error('connection lost')) };
    const binder = createNonRefusingCaptureBinder({ ledger: broken, legs, savepoint });

    await expect(binder.bindEach(null, TENANT, [kept('T1')], SOLD_AT, w.sale(), new Map())).rejects.toThrow('connection lost');
    expect(calls).toEqual(['open']);
    await expect(binder.recordEach(TENANT, [kept('T2')], SOLD_AT)).resolves.toEqual(new Map());
  });
});
