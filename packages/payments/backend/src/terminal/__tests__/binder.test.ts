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

function binderOf(w: World, savepoint: Savepoint = w.captures.savepoint) {
  const legs = createTerminalLegs({ ledger: w.ledger, directory: w.directory, now: () => NOW });
  return createNonRefusingCaptureBinder({ legs, savepoint });
}

const traced = (code: string, overrides: Partial<ReturnType<typeof wire>> = {}): SaleCapture => ({
  code,
  wire: wire({ transactionCode: code, ...overrides }),
});

/** Step 1 then step 2, as a sync books one sale. */
async function book(w: World, captures: SaleCapture[]) {
  const subject = binderOf(w);
  const target = w.sale();
  const notBound = await subject.recordEach(TENANT, captures);
  const missed = await w.captures.transaction(() => subject.bindEach(null, TENANT, captures, target, notBound));
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

describe('the savepoint per capture', () => {
  it('rolls back only the capture that will not bind; the rest of the sale’s writes stand', async () => {
    const w = world();
    const binder = binderOf(w);
    const target = w.sale();
    const other = w.sale();
    // Recorded fine before the transaction, then taken by another sale before the bind.
    const captures = [traced('OK'), traced('TAKEN')];
    const notBound = await binder.recordEach(TENANT, captures);
    await w.ledger.markSaleCreated(null, { clientId: TENANT, transactionCode: 'TAKEN' }, other.orderId);

    const missed = await binder.bindEach(null, TENANT, captures, target, notBound);

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
    const notBound = await binder.recordEach(TENANT, captures);
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'LATE' }, 'SALE_CANCELLED', NOW);

    const missed = await binder.bindEach('tx-1', TENANT, captures, target, notBound);

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
    const broken = { ...w.ledger, bind: () => Promise.reject(new Error('connection lost')) };
    const legs = createTerminalLegs({ ledger: broken, directory: w.directory, now: () => NOW });
    const binder = createNonRefusingCaptureBinder({ legs, savepoint });
    const target = w.sale();
    await w.ledger.record({ ...wire({ transactionCode: 'T1' }), clientId: TENANT, source: 'DEVICE', capturedAt: NOW });
    await w.ledger.markSaleCreated(null, { clientId: TENANT, transactionCode: 'T1' }, target.orderId);

    await expect(binder.bindEach(null, TENANT, [traced('T1')], target, new Map())).rejects.toThrow('connection lost');
    expect(calls).toEqual(['open']);
    await expect(binder.recordEach(TENANT, [traced('T2')])).resolves.toEqual(new Map());
  });
});
