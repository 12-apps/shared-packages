import { describe, expect, it } from 'vitest';

import { createTerminalCaptureLedger } from '../ledger';
import { DAY, NOW, OTHER_TENANT, TENANT, capture, flagAfterFirstRead, refusal, world } from './world';

/**
 * The capture ledger against the in-memory store. Ported case for case from
 * the origin host's integration suite over its production migrations: a
 * capture is recorded once per tenant and code, whichever transport brings it;
 * its state moves UNBOUND -> ORDER_CREATED -> BOUND and never to a second sale;
 * its refund flag is written once; the sweep flags exactly the captures no
 * sale claimed within the window, on both clocks.
 */

const key = (transactionCode = 'TC-0001') => ({ clientId: TENANT, transactionCode });

describe('recording', () => {
  it('records a capture with its whole trace, UNBOUND', async () => {
    const w = world();
    const { capture: recorded, created } = await w.ledger.record(capture());

    expect(created).toBe(true);
    expect(w.row('TC-0001')).toMatchObject({
      id: recorded.id,
      clientId: TENANT,
      kind: 'CREDIT',
      amountCents: 2500,
      state: 'UNBOUND',
      source: 'DEVICE',
      orderId: null,
      paymentId: null,
      transactionId: 'TID-0001',
      hostNsu: '000123',
      authorizationCode: 'A1B2C3',
      cardBrand: 'VISA',
      installments: 1,
      terminalSerial: 'PBA-SERIAL-1',
      entryMode: 'CHIP',
      capturedAt: NOW,
      refundFlaggedAt: null,
    });
  });

  it('answers a replay of the same code with the stored row and writes nothing (first report wins)', async () => {
    const w = world();
    const first = await w.ledger.record(capture());
    const replay = await w.ledger.record(capture({ source: 'STATION', cardBrand: null, hostNsu: null }));

    expect(replay.created).toBe(false);
    expect(replay.capture.id).toBe(first.capture.id);
    expect(replay.capture).toMatchObject({ source: 'DEVICE', cardBrand: 'VISA', hostNsu: '000123' });
    expect(w.rows()).toHaveLength(1);
  });

  it('refuses the same code with another amount, or another kind, as a CONFLICT and keeps the first', async () => {
    const w = world();
    await w.ledger.record(capture());

    expect((await refusal(w.ledger.record(capture({ amountCents: 2600 })))).code).toBe('CONFLICT');
    expect((await refusal(w.ledger.record(capture({ kind: 'DEBIT' })))).code).toBe('CONFLICT');
    expect(w.rows()).toEqual([expect.objectContaining({ amountCents: 2500, kind: 'CREDIT' })]);
  });

  it("keys the code by tenant: another tenant's capture under the same code is its own row", async () => {
    const w = world();
    await w.ledger.record(capture());
    const other = await w.ledger.record(capture({ clientId: OTHER_TENANT, amountCents: 999 }));

    expect(other.created).toBe(true);
    await expect(w.ledger.findByCodes(TENANT, ['TC-0001'])).resolves.toEqual([expect.objectContaining({ amountCents: 2500 })]);
    await expect(w.ledger.findByCodes(OTHER_TENANT, ['TC-0001'])).resolves.toEqual([expect.objectContaining({ amountCents: 999 })]);
  });

  it("refuses a terminal that is not the tenant's, writing nothing", async () => {
    const w = world();
    const elsewhere = w.device(OTHER_TENANT);

    expect((await refusal(w.ledger.record(capture({ deviceId: elsewhere })))).code).toBe('DEVICE_MISMATCH');
    expect(w.rows()).toHaveLength(0);
    await expect(w.ledger.record(capture({ deviceId: w.device() }))).resolves.toMatchObject({ created: true });
  });

  it("finds a tenant's captures by code, and nothing of another tenant's", async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.record(capture({ transactionCode: 'TC-0002', kind: 'PIX' }));
    await w.ledger.record(capture({ clientId: OTHER_TENANT, transactionCode: 'TC-0003' }));

    const found = await w.ledger.findByCodes(TENANT, ['TC-0001', 'TC-0002', 'TC-0003', 'TC-0001']);

    expect(found.map((c) => c.transactionCode).sort()).toEqual(['TC-0001', 'TC-0002']);
    await expect(w.ledger.findByCodes(TENANT, [])).resolves.toEqual([]);
  });
});

describe('the state', () => {
  it('moves UNBOUND -> ORDER_CREATED -> BOUND, and replays of each step are no-ops', async () => {
    const w = world();
    await w.ledger.record(capture());
    const target = w.sale();

    await expect(w.ledger.markSaleCreated(null, key(), target.orderId)).resolves.toMatchObject({
      state: 'ORDER_CREATED',
      orderId: target.orderId,
      paymentId: null,
    });
    await expect(w.ledger.markSaleCreated(null, key(), target.orderId)).resolves.toMatchObject({ state: 'ORDER_CREATED' });

    const [bound] = await w.ledger.bind(null, TENANT, ['TC-0001'], target);
    expect(bound).toMatchObject({ state: 'BOUND', orderId: target.orderId, paymentId: target.paymentId });
    const [again] = await w.ledger.bind(null, TENANT, ['TC-0001'], target);
    expect(again).toMatchObject({ state: 'BOUND', paymentId: target.paymentId });
    await expect(w.ledger.markSaleCreated(null, key(), target.orderId)).resolves.toMatchObject({ state: 'BOUND' });
  });

  it('binds an UNBOUND capture straight to the payment row, several legs at once', async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.record(capture({ transactionCode: 'TC-0002', kind: 'PIX' }));
    const target = w.sale();

    const bound = await w.ledger.bind(null, TENANT, ['TC-0001', 'TC-0002', 'TC-0001'], target);

    expect(bound.map((c) => c.state)).toEqual(['BOUND', 'BOUND']);
    expect(w.rows().filter((row) => row.paymentId === target.paymentId)).toHaveLength(2);
  });

  it("refuses a bind to another sale once bound, and the caller's transaction rolls the whole bind back", async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.record(capture({ transactionCode: 'TC-0002' }));
    const first = w.sale();
    const second = w.sale();
    await w.ledger.bind(null, TENANT, ['TC-0001'], first);

    const refused = await refusal(w.captures.transaction(() => w.ledger.bind(null, TENANT, ['TC-0002', 'TC-0001'], second)));

    expect(refused).toMatchObject({ code: 'BOUND_ELSEWHERE', transactionCode: 'TC-0001' });
    expect(w.row('TC-0001')).toMatchObject({ state: 'BOUND', paymentId: first.paymentId });
    expect(w.row('TC-0002')).toMatchObject({ state: 'UNBOUND', paymentId: null });
  });

  it('refuses binding a capture created for another sale, and marking it for another sale', async () => {
    const w = world();
    await w.ledger.record(capture());
    const first = w.sale();
    const second = w.sale();
    await w.ledger.markSaleCreated(null, key(), first.orderId);

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], second))).code).toBe('BOUND_ELSEWHERE');
    expect((await refusal(w.ledger.markSaleCreated(null, key(), second.orderId))).code).toBe('BOUND_ELSEWHERE');
  });

  it("refuses another tenant's sale or payment row, and a code the tenant does not hold", async () => {
    const w = world();
    await w.ledger.record(capture());
    const foreign = w.sale(OTHER_TENANT);
    const own = w.sale();

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], foreign))).code).toBe('SALE_MISMATCH');
    expect((await refusal(w.ledger.markSaleCreated(null, key(), foreign.orderId))).code).toBe('SALE_MISMATCH');
    const crossed = { orderId: own.orderId, paymentId: w.sale().paymentId };
    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], crossed))).code).toBe('SALE_MISMATCH');
    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-9999'], own))).code).toBe('NOT_FOUND');
    expect(w.row('TC-0001')).toMatchObject({ state: 'UNBOUND' });
    await expect(w.ledger.bind(null, TENANT, [], own)).resolves.toEqual([]);
  });

  it('refuses marking a sale created for a capture flagged for a refund a bind would refuse', async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.record(capture({ transactionCode: 'TC-0002' }));
    await w.ledger.flag(key(), 'SALE_NOT_CREATED', NOW);
    await w.ledger.flag(key('TC-0002'), 'UNBOUND_TIMEOUT', NOW);
    const target = w.sale();

    expect((await refusal(w.ledger.markSaleCreated(null, key(), target.orderId))).code).toBe('FLAGGED');
    expect(w.row('TC-0001')).toMatchObject({ state: 'UNBOUND', orderId: null });
    await expect(w.ledger.markSaleCreated(null, key('TC-0002'), target.orderId)).resolves.toMatchObject({
      state: 'ORDER_CREATED',
      orderId: target.orderId,
    });
  });
});

describe('a flag that lands between a move’s read and its write (compare-and-set)', () => {
  const later = new Date(NOW.getTime() + 60_000);

  it('a bind decided on the read refuses a cancel flag committed before its write', async () => {
    let armed = false;
    const w = world({ wrap: flagAfterFirstRead({ reason: 'SALE_CANCELLED', at: NOW }, () => armed) });
    await w.ledger.record(capture());
    armed = true;
    const target = w.sale();

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], target, later))).code).toBe('FLAGGED');
    expect(w.row('TC-0001')).toMatchObject({ state: 'UNBOUND', paymentId: null, refundReason: 'SALE_CANCELLED' });
  });

  it('a bind decided on the read clears a timeout flag the sweep committed before its write', async () => {
    let armed = false;
    const w = world({ wrap: flagAfterFirstRead({ reason: 'UNBOUND_TIMEOUT', at: NOW }, () => armed) });
    await w.ledger.record(capture());
    armed = true;
    const target = w.sale();

    const [bound] = await w.ledger.bind(null, TENANT, ['TC-0001'], target, later);

    expect(bound).toMatchObject({
      state: 'BOUND',
      paymentId: target.paymentId,
      refundFlaggedAt: NOW,
      refundReason: 'UNBOUND_TIMEOUT',
      refundClearedAt: later,
    });
  });

  it('marking a sale created refuses a flag committed before its write', async () => {
    let armed = false;
    const w = world({ wrap: flagAfterFirstRead({ reason: 'SALE_NOT_CREATED', at: NOW }, () => armed) });
    await w.ledger.record(capture());
    armed = true;
    const target = w.sale();

    expect((await refusal(w.ledger.markSaleCreated(null, key(), target.orderId))).code).toBe('FLAGGED');
    expect(w.row('TC-0001')).toMatchObject({ state: 'UNBOUND', orderId: null });
  });

  it('gives up as CONTENDED, writing nothing, when the row keeps changing under the move', async () => {
    const w = world({
      wrap: (store) => ({ ...store, writeIfUnchanged: async () => false }),
    });
    await w.ledger.record(capture());
    const target = w.sale();

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], target))).code).toBe('CONTENDED');
    expect((await refusal(w.ledger.markSaleCreated(null, key(), target.orderId))).code).toBe('CONTENDED');
    expect(w.row('TC-0001')).toMatchObject({ state: 'UNBOUND', orderId: null });
  });
});

describe('the refund flag', () => {
  it('is written once: a second flag, for any reason, writes nothing', async () => {
    const w = world();
    await w.ledger.record(capture());

    await expect(w.ledger.flag(key(), 'SALE_CANCELLED', NOW)).resolves.toEqual({ flagged: true });
    await expect(w.ledger.flag(key(), 'PAYMENT_UNDONE', new Date(NOW.getTime() + 60_000))).resolves.toEqual({ flagged: false });

    expect(w.row('TC-0001')).toMatchObject({ refundFlaggedAt: NOW, refundReason: 'SALE_CANCELLED' });
    expect((await refusal(w.ledger.flag(key('TC-9999'), 'SALE_CANCELLED'))).code).toBe('NOT_FOUND');
  });

  it('refuses the reasons that mean no sale holds the capture on a capture a sale holds, writing nothing', async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.record(capture({ transactionCode: 'TC-0002' }));
    const target = w.sale();
    await w.ledger.bind(null, TENANT, ['TC-0001'], target);
    await w.ledger.markSaleCreated(null, key('TC-0002'), target.orderId);

    for (const code of ['TC-0001', 'TC-0002']) {
      for (const reason of ['SALE_NOT_CREATED', 'UNBOUND_TIMEOUT'] as const) {
        expect((await refusal(w.ledger.flag(key(code), reason, NOW))).code).toBe('NOT_UNBOUND');
      }
    }
    expect(w.rows().filter((row) => row.refundFlaggedAt !== null)).toHaveLength(0);
    await expect(w.ledger.flag(key(), 'SALE_CANCELLED', NOW)).resolves.toEqual({ flagged: true });
  });

  it('refuses binding a capture flagged because its sale was cancelled', async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.flag(key(), 'SALE_CANCELLED', NOW);

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], w.sale()))).code).toBe('FLAGGED');
  });

  it('flags every capture a sale holds once, re-arms a cleared flag, and leaves a live one alone', async () => {
    const w = world();
    const target = w.sale();
    for (const code of ['A', 'B', 'C', 'D']) await w.ledger.record(capture({ transactionCode: code }));
    await w.ledger.markSaleCreated(null, key('A'), target.orderId);
    await w.ledger.flag(key('C'), 'UNBOUND_TIMEOUT', NOW);
    await w.ledger.bind(null, TENANT, ['B', 'C'], target);
    await w.ledger.flag(key('B'), 'PAYMENT_UNDONE', NOW);

    // A (ORDER_CREATED) and C (a cleared timeout flag) are flagged; B's live flag stays; D is no sale's.
    await expect(w.ledger.flagSale(TENANT, target.orderId, 'SALE_CANCELLED')).resolves.toBe(2);
    expect(w.row('A')).toMatchObject({ refundReason: 'SALE_CANCELLED', refundClearedAt: null });
    expect(w.row('B')).toMatchObject({ refundReason: 'PAYMENT_UNDONE' });
    expect(w.row('C')).toMatchObject({ refundReason: 'SALE_CANCELLED', refundClearedAt: null });
    expect(w.row('D')).toMatchObject({ refundFlaggedAt: null });
    await expect(w.ledger.flagSale(TENANT, target.orderId, 'SALE_CANCELLED')).resolves.toBe(0);
    await expect(w.ledger.flagSale(OTHER_TENANT, target.orderId, 'SALE_CANCELLED')).resolves.toBe(0);
  });
});

describe('the refund sweep', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it('flags exactly the UNBOUND captures a window old and never flagged, once each, across tenants', async () => {
    const w = world();
    const target = w.sale();
    const old = (code: string, at: Date, clientId = TENANT) => w.ledger.record(capture({ clientId, transactionCode: code, capturedAt: at }));
    await old('STALE', ago(DAY + 60_000));
    await old('AT-THE-LINE', ago(DAY));
    await old('STALE-ELSEWHERE', ago(2 * DAY), OTHER_TENANT);
    await old('FRESH', ago(DAY - 60_000));
    await old('CREATED', ago(2 * DAY));
    await old('BOUND', ago(2 * DAY));
    await old('FLAGGED', ago(2 * DAY));
    await w.ledger.markSaleCreated(null, key('CREATED'), target.orderId);
    await w.ledger.bind(null, TENANT, ['BOUND'], target);
    await w.ledger.flag(key('FLAGGED'), 'SALE_NOT_CREATED', ago(60_000));
    for (const row of w.rows()) w.captures.setRecordedAt(row.clientId, row.transactionCode, row.capturedAt);

    await expect(w.ledger.flagStaleUnbound(NOW, 100)).resolves.toBe(3);

    for (const [code, tenant] of [['STALE', TENANT], ['AT-THE-LINE', TENANT], ['STALE-ELSEWHERE', OTHER_TENANT]] as const) {
      expect(w.row(code, tenant), code).toMatchObject({ refundFlaggedAt: NOW, refundReason: 'UNBOUND_TIMEOUT' });
    }
    for (const code of ['FRESH', 'CREATED', 'BOUND']) {
      expect(w.row(code), code).toMatchObject({ refundFlaggedAt: null, refundReason: null });
    }
    expect(w.row('FLAGGED')).toMatchObject({ refundFlaggedAt: ago(60_000), refundReason: 'SALE_NOT_CREATED' });
    await expect(w.ledger.flagStaleUnbound(NOW, 100)).resolves.toBe(0);
  });

  it('drains a backlog in ticks of `limit`, oldest first', async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) {
      await w.ledger.record(capture({ transactionCode: `OLD-${i}`, capturedAt: ago(DAY + (3 - i) * 60_000) }));
    }
    for (const row of w.rows()) w.captures.setRecordedAt(row.clientId, row.transactionCode, row.capturedAt);

    await expect(w.ledger.flagStaleUnbound(NOW, 2)).resolves.toBe(2);
    expect(w.rows().filter((row) => row.refundFlaggedAt !== null).map((row) => row.transactionCode).sort()).toEqual(['OLD-0', 'OLD-1']);
    await expect(w.ledger.flagStaleUnbound(NOW, 2)).resolves.toBe(1);
  });

  it('lets a sale that arrives after the sweep still bind its capture, and clears the flag', async () => {
    const w = world();
    await w.ledger.record(capture({ capturedAt: ago(DAY + 60_000) }));
    w.captures.setRecordedAt(TENANT, 'TC-0001', ago(DAY + 60_000));
    await w.ledger.flagStaleUnbound(NOW, 100);
    const later = new Date(NOW.getTime() + 60_000);

    const [bound] = await w.ledger.bind(null, TENANT, ['TC-0001'], w.sale(), later);

    expect(bound).toMatchObject({ state: 'BOUND', refundFlaggedAt: NOW, refundReason: 'UNBOUND_TIMEOUT', refundClearedAt: later });
  });

  it('re-arms a cleared timeout flag when the late sale is undone, once per real refund', async () => {
    const w = world();
    await w.ledger.record(capture({ capturedAt: ago(DAY + 60_000) }));
    w.captures.setRecordedAt(TENANT, 'TC-0001', ago(DAY + 60_000));
    await w.ledger.flagStaleUnbound(NOW, 100);
    const undoneAt = new Date(NOW.getTime() + 120_000);
    await w.ledger.bind(null, TENANT, ['TC-0001'], w.sale(), new Date(NOW.getTime() + 60_000));

    await expect(w.ledger.flag(key(), 'PAYMENT_UNDONE', undoneAt)).resolves.toEqual({ flagged: true });
    expect(w.row('TC-0001')).toMatchObject({ state: 'BOUND', refundFlaggedAt: undoneAt, refundReason: 'PAYMENT_UNDONE', refundClearedAt: null });
    await expect(w.ledger.flag(key(), 'SALE_CANCELLED', new Date(NOW.getTime() + 180_000))).resolves.toEqual({ flagged: false });
    expect(w.row('TC-0001')).toMatchObject({ refundFlaggedAt: undoneAt, refundReason: 'PAYMENT_UNDONE' });
  });

  it("waits the window on the store's clock too: a terminal clock reset to the past does not flag a fresh capture", async () => {
    const w = world();
    await w.ledger.record(capture({ capturedAt: ago(2 * DAY) }));
    w.captures.setRecordedAt(TENANT, 'TC-0001', ago(60_000));

    await expect(w.ledger.flagStaleUnbound(NOW, 100)).resolves.toBe(0);
    expect(w.row('TC-0001')).toMatchObject({ refundFlaggedAt: null, capturedAt: ago(2 * DAY) });
    await expect(w.ledger.flagStaleUnbound(new Date(NOW.getTime() + DAY), 100)).resolves.toBe(1);
  });
});

describe('the required config', () => {
  it('refuses a ledger without a positive window or amount ceiling', () => {
    const w = world();
    const base = { store: w.captures.storeFor, directory: w.directory, sales: w.sales };
    expect(() => createTerminalCaptureLedger({ ...base, maxAmountCents: 1, unboundRefundAfterMs: 0 })).toThrow(/unboundRefundAfterMs/);
    expect(() => createTerminalCaptureLedger({ ...base, maxAmountCents: Number.NaN, unboundRefundAfterMs: DAY })).toThrow(/maxAmountCents/);
  });
});
