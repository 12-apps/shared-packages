import { describe, expect, it, vi } from 'vitest';

import { createTerminalLegs } from '../legs';
import { createTerminalCaptureLedger } from '../ledger';
import type { TerminalCaptureStore } from '../ports';
import {
  CAPTURE_HOLD_SELECT,
  CAPTURE_SELECT,
  createPrismaTerminalCaptureStore,
  prismaTerminalCaptureStoreFor,
  type PrismaTerminalCaptureClient,
} from '../prisma-store';
import { DAY, NOW, OTHER_TENANT, TENANT, capture, refusal, world, type World } from './world';

/**
 * FUT-3770: a capture a settle refused because the bill GREW is held for the
 * sale context the host names (`holdKey`), so ANY terminal settling that
 * context is offered it as money already received. A bind lets go of the
 * hold; a flagged capture is never offered; the once-per-capture flag and the
 * idempotency on the transaction code stay as they were.
 */

const CONTEXT = 'context-1';
const OTHER_CONTEXT = 'context-2';
const key = (transactionCode = 'TC-0001', clientId = TENANT) => ({ clientId, transactionCode });

function legsOf(w: World) {
  return createTerminalLegs({ ledger: w.ledger, directory: w.directory, now: () => NOW });
}

/** A capture taken by one terminal, as the terminal reported it. */
async function taken(w: World, code = 'TC-0001', deviceId = w.device()) {
  await w.ledger.record(capture({ transactionCode: code, deviceId }));
  return deviceId;
}

describe('hold: a refused capture kept for its sale context', () => {
  it('holds an UNBOUND capture for the context, and leaves it UNBOUND and unflagged', async () => {
    const w = world();
    await taken(w);

    await expect(w.ledger.hold(key(), CONTEXT)).resolves.toEqual({ held: true });
    expect(w.row('TC-0001')).toMatchObject({ state: 'UNBOUND', holdKey: CONTEXT, refundFlaggedAt: null, orderId: null });
  });

  it('a second hold for the same context is idempotent and writes nothing', async () => {
    const w = world();
    await taken(w);
    await w.ledger.hold(key(), CONTEXT);
    const before = w.row('TC-0001');

    await expect(w.ledger.hold(key(), CONTEXT)).resolves.toEqual({ held: false });
    expect(w.row('TC-0001')).toEqual(before);
  });

  it('refuses a hold for another context as BOUND_ELSEWHERE, keeping the first', async () => {
    const w = world();
    await taken(w);
    await w.ledger.hold(key(), CONTEXT);

    expect((await refusal(w.ledger.hold(key(), OTHER_CONTEXT))).code).toBe('BOUND_ELSEWHERE');
    expect(w.row('TC-0001').holdKey).toBe(CONTEXT);
  });

  it('refuses a capture a sale holds (NOT_UNBOUND) and a flagged one (FLAGGED), writing nothing', async () => {
    const w = world();
    await taken(w, 'TC-BOUND');
    await w.ledger.bind(null, TENANT, ['TC-BOUND'], w.sale());
    await taken(w, 'TC-FLAG');
    await w.ledger.flag(key('TC-FLAG'), 'RECEIVED_TWICE');
    await taken(w, 'TC-TIMEOUT');
    await w.ledger.flag(key('TC-TIMEOUT'), 'UNBOUND_TIMEOUT');

    expect((await refusal(w.ledger.hold(key('TC-BOUND'), CONTEXT))).code).toBe('NOT_UNBOUND');
    expect((await refusal(w.ledger.hold(key('TC-FLAG'), CONTEXT))).code).toBe('FLAGGED');
    expect((await refusal(w.ledger.hold(key('TC-TIMEOUT'), CONTEXT))).code).toBe('FLAGGED');
    expect(w.rows().every((row) => row.holdKey === undefined)).toBe(true);
  });

  it('refuses an unknown code (NOT_FOUND), another tenant’s capture, and an empty key', async () => {
    const w = world();
    await taken(w);

    expect((await refusal(w.ledger.hold(key('TC-NONE'), CONTEXT))).code).toBe('NOT_FOUND');
    expect((await refusal(w.ledger.hold(key('TC-0001', OTHER_TENANT), CONTEXT))).code).toBe('NOT_FOUND');
    await expect(w.ledger.hold(key(), '')).rejects.toThrow('holdKey');
    expect(w.row('TC-0001').holdKey).toBeUndefined();
  });

  it('two contexts racing for one capture: the hold is in the write predicate, the loser decides again and is refused', async () => {
    // One race, landed between the move's read and its write: the other context holds it first.
    const races: (() => Promise<void>)[] = [];
    const w = world({
      wrap: (store): TerminalCaptureStore => ({
        ...store,
        async writeIfUnchanged(seen, patch) {
          await races.shift()?.();
          return store.writeIfUnchanged(seen, patch);
        },
      }),
    });
    await taken(w);
    races.push(async () => void (await w.captures.store.writeIfUnchanged({ ...versionFor(w), holdKey: null }, { holdKey: OTHER_CONTEXT })));

    expect((await refusal(w.ledger.hold(key(), CONTEXT))).code).toBe('BOUND_ELSEWHERE');
    expect(w.row('TC-0001').holdKey).toBe(OTHER_CONTEXT);
  });

  it('keeps the once-per-capture flag and the code idempotency as they were', async () => {
    const w = world();
    const deviceId = await taken(w);
    await w.ledger.hold(key(), CONTEXT);

    const replay = await w.ledger.record(capture({ deviceId }));
    expect(replay.created).toBe(false);
    expect((await refusal(w.ledger.record(capture({ deviceId, amountCents: 9999 })))).code).toBe('CONFLICT');
    await expect(w.ledger.flag(key(), 'BILL_REDUCED')).resolves.toEqual({ flagged: true });
    await expect(w.ledger.flag(key(), 'BILL_REDUCED')).resolves.toEqual({ flagged: false });
  });
});

function versionFor(w: World, code = 'TC-0001') {
  const row = w.row(code);
  return { id: row.id, state: row.state, orderId: row.orderId, refundFlaggedAt: row.refundFlaggedAt, refundClearedAt: row.refundClearedAt };
}

describe('findHeld / heldFor: any terminal settling the context sees the money', () => {
  it('another terminal of the tenant is offered a capture the first terminal took, as the leg wire', async () => {
    const w = world();
    const first = await taken(w, 'TC-A');
    await w.ledger.hold(key('TC-A'), CONTEXT);

    const offered = await legsOf(w).heldFor(TENANT, CONTEXT);
    expect(offered).toEqual([expect.objectContaining({ transactionCode: 'TC-A', amountCents: 2500, kind: 'CREDIT', deviceId: first })]);
    // Not "received, no sale" on the terminal that took it: it is the context's money.
    expect(await legsOf(w).unclaimed(TENANT, [first])).toEqual([]);
  });

  it('answers only this context and this tenant, oldest first', async () => {
    const w = world();
    const deviceId = w.device();
    await w.ledger.record(capture({ transactionCode: 'TC-LATE', deviceId, capturedAt: new Date(NOW.getTime() + 60_000) }));
    await w.ledger.record(capture({ transactionCode: 'TC-EARLY', deviceId, capturedAt: new Date(NOW.getTime() - 60_000) }));
    await w.ledger.record(capture({ transactionCode: 'TC-ELSE', deviceId }));
    await w.ledger.record(capture({ transactionCode: 'TC-LOOSE', deviceId }));
    const otherDevice = w.device(OTHER_TENANT);
    await w.ledger.record(capture({ clientId: OTHER_TENANT, transactionCode: 'TC-OTHER', deviceId: otherDevice }));
    await w.ledger.hold(key('TC-LATE'), CONTEXT);
    await w.ledger.hold(key('TC-EARLY'), CONTEXT);
    await w.ledger.hold(key('TC-ELSE'), OTHER_CONTEXT);
    await w.ledger.hold(key('TC-OTHER', OTHER_TENANT), CONTEXT);

    expect((await w.ledger.findHeld(TENANT, CONTEXT)).map((row) => row.transactionCode)).toEqual(['TC-EARLY', 'TC-LATE']);
    expect((await w.ledger.findHeld(OTHER_TENANT, CONTEXT)).map((row) => row.transactionCode)).toEqual(['TC-OTHER']);
  });

  it('never offers a held capture once it is flagged (the sweep, or a refund)', async () => {
    const w = world();
    await taken(w, 'TC-SWEPT');
    await taken(w, 'TC-REFUND');
    await w.ledger.hold(key('TC-SWEPT'), CONTEXT);
    await w.ledger.hold(key('TC-REFUND'), CONTEXT);
    await w.ledger.flag(key('TC-REFUND'), 'RECEIVED_TWICE');

    expect(await w.ledger.findHeld(TENANT, CONTEXT)).toHaveLength(1);
    // The 24 h sweep still reads a held capture as UNBOUND: a hold does not extend the window.
    await w.ledger.flagStaleUnbound(new Date(NOW.getTime() + 2 * DAY), 10);
    expect(await w.ledger.findHeld(TENANT, CONTEXT)).toEqual([]);
  });

  it('a bind takes the held capture and lets go of the hold; a replayed bind writes nothing', async () => {
    const w = world();
    await taken(w, 'TC-A');
    await w.ledger.hold(key('TC-A'), CONTEXT);
    const target = { ...w.sale(), holdKey: CONTEXT };

    await w.ledger.bind(null, TENANT, ['TC-A'], target);
    expect(w.row('TC-A')).toMatchObject({ state: 'BOUND', orderId: target.orderId, paymentId: target.paymentId });
    expect(w.row('TC-A').holdKey).toBeUndefined();
    expect(await w.ledger.findHeld(TENANT, CONTEXT)).toEqual([]);
    const report = await w.ledger.bindReporting(null, TENANT, ['TC-A'], target);
    expect(report.moved).toEqual([]);
  });

  it('the settle hook (bindingFor) on another terminal binds the held capture with a fresh one', async () => {
    const w = world();
    await taken(w, 'TC-A');
    await w.ledger.hold(key('TC-A'), CONTEXT);
    const legs = legsOf(w);
    const held = await legs.heldFor(TENANT, CONTEXT);
    const fresh = { ...held[0]!, transactionCode: 'TC-B', amountCents: 1000, deviceId: w.device() };
    const target = w.sale();

    await legs.bindingFor(TENANT, target.orderId, [...held, fresh], CONTEXT)!.bind(null, target.paymentId);
    expect(w.row('TC-A')).toMatchObject({ state: 'BOUND', paymentId: target.paymentId });
    expect(w.row('TC-B')).toMatchObject({ state: 'BOUND', paymentId: target.paymentId });
    expect(await legs.heldFor(TENANT, CONTEXT)).toEqual([]);
  });

  it('a sale marking the capture created lets go of the hold too, and a rolled-back bind restores it', async () => {
    const w = world();
    await taken(w, 'TC-A');
    await w.ledger.hold(key('TC-A'), CONTEXT);
    const { orderId } = w.sale();

    await expect(w.captures.transaction(async () => {
      await w.ledger.bind(null, TENANT, ['TC-A'], { ...w.sale(), holdKey: CONTEXT });
      throw new Error('the settle rolled back');
    })).rejects.toThrow('rolled back');
    expect(w.row('TC-A').holdKey).toBe(CONTEXT);

    await w.ledger.markSaleCreated(null, key('TC-A'), orderId, CONTEXT);
    expect(w.row('TC-A')).toMatchObject({ state: 'ORDER_CREATED', orderId });
    expect(w.row('TC-A').holdKey).toBeUndefined();
  });
});

describe('held for one context: no other sale takes it', () => {
  /** TC-A taken by a terminal and held for CONTEXT, as a refused settle leaves it. */
  async function heldForContext(w: World) {
    const deviceId = await taken(w, 'TC-A');
    await w.ledger.hold(key('TC-A'), CONTEXT);
    const [heldWire] = await legsOf(w).heldFor(TENANT, CONTEXT);
    if (!heldWire) throw new Error('TC-A is not held');
    return { deviceId, heldWire };
  }

  it('heldForSale and held refuse it as BOUND_ELSEWHERE for another context or for none', async () => {
    const w = world();
    const { heldWire } = await heldForContext(w);
    const legs = legsOf(w);
    const { orderId } = w.sale();

    await expect(legs.heldForSale(TENANT, orderId, [heldWire])).resolves.toEqual({ kind: 'REFUSED', code: 'BOUND_ELSEWHERE' });
    await expect(legs.heldForSale(TENANT, orderId, [heldWire], OTHER_CONTEXT)).resolves.toEqual({ kind: 'REFUSED', code: 'BOUND_ELSEWHERE' });
    await expect(legs.held(TENANT, [heldWire])).resolves.toEqual({ ok: false, code: 'BOUND_ELSEWHERE' });
    await expect(legs.heldForSale(TENANT, orderId, [heldWire], CONTEXT)).resolves.toEqual({ kind: 'PROCEED' });
  });

  it('bindingFor another sale throws BOUND_ELSEWHERE and the capture stays held for its context', async () => {
    const w = world();
    const { heldWire } = await heldForContext(w);
    const target = w.sale();

    for (const holdKey of [undefined, OTHER_CONTEXT]) {
      const binding = legsOf(w).bindingFor(TENANT, target.orderId, [heldWire], holdKey);
      expect((await refusal(binding!.bind(null, target.paymentId))).code).toBe('BOUND_ELSEWHERE');
    }
    expect(w.row('TC-A')).toMatchObject({ state: 'UNBOUND', orderId: null, holdKey: CONTEXT });
    expect(await legsOf(w).heldFor(TENANT, CONTEXT)).toHaveLength(1);
  });

  it('markSaleCreated (and markCreatedIn) for another sale is refused, the hold kept', async () => {
    const w = world();
    const { heldWire } = await heldForContext(w);
    const { orderId } = w.sale();

    expect((await refusal(w.ledger.markSaleCreated(null, key('TC-A'), orderId))).code).toBe('BOUND_ELSEWHERE');
    expect((await refusal(w.ledger.markSaleCreated(null, key('TC-A'), orderId, OTHER_CONTEXT))).code).toBe('BOUND_ELSEWHERE');
    expect((await refusal(legsOf(w).markCreatedIn(null, TENANT, [heldWire], orderId))).code).toBe('BOUND_ELSEWHERE');
    expect(w.row('TC-A')).toMatchObject({ state: 'UNBOUND', orderId: null, holdKey: CONTEXT });
  });

  it('the terminal that took it does not list it as unclaimed', async () => {
    const w = world();
    const { deviceId } = await heldForContext(w);
    await taken(w, 'TC-LOOSE', deviceId);

    expect((await legsOf(w).unclaimed(TENANT, [deviceId])).map((wire) => wire.transactionCode)).toEqual(['TC-LOOSE']);
  });

  it('a settle of the SAME context binds it and lets go of the hold', async () => {
    const w = world();
    const { heldWire } = await heldForContext(w);
    const target = w.sale();
    const legs = legsOf(w);

    await expect(legs.heldForSale(TENANT, target.orderId, [heldWire], CONTEXT)).resolves.toEqual({ kind: 'PROCEED' });
    await legs.bindingFor(TENANT, target.orderId, [heldWire], CONTEXT)!.bind(null, target.paymentId);
    expect(w.row('TC-A')).toMatchObject({ state: 'BOUND', orderId: target.orderId, paymentId: target.paymentId });
    expect(w.row('TC-A').holdKey).toBeUndefined();
    await expect(legs.heldForSale(TENANT, target.orderId, [heldWire], CONTEXT)).resolves.toEqual({ kind: 'ALL_BOUND' });
  });

  it('a hold landing between another sale’s bind read and its write: the bind decides again and is refused', async () => {
    const races: (() => Promise<void>)[] = [];
    const w = world({
      wrap: (store): TerminalCaptureStore => ({
        ...store,
        async writeIfUnchanged(seen, patch) {
          await races.shift()?.();
          return store.writeIfUnchanged(seen, patch);
        },
      }),
    });
    await taken(w, 'TC-A');
    const target = w.sale();
    races.push(async () => void (await w.captures.store.writeIfUnchanged({ ...versionFor(w, 'TC-A'), holdKey: null }, { holdKey: CONTEXT })));

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-A'], target))).code).toBe('BOUND_ELSEWHERE');
    expect(w.row('TC-A')).toMatchObject({ state: 'UNBOUND', orderId: null, holdKey: CONTEXT });
  });

  it('review repro: the taking terminal cannot spend a context’s held money on another sale', async () => {
    const w = world();
    const legs = legsOf(w);
    const { deviceId, heldWire } = await heldForContext(w);
    const saleB = w.sale();

    expect(await legs.unclaimed(TENANT, [deviceId])).toEqual([]);
    await expect(legs.heldForSale(TENANT, saleB.orderId, [heldWire])).resolves.toEqual({ kind: 'REFUSED', code: 'BOUND_ELSEWHERE' });
    expect((await refusal(legs.bindingFor(TENANT, saleB.orderId, [heldWire])!.bind(null, saleB.paymentId))).code).toBe('BOUND_ELSEWHERE');
    expect(w.row('TC-A')).toMatchObject({ state: 'UNBOUND', orderId: null, holdKey: CONTEXT });
    expect((await legs.heldFor(TENANT, CONTEXT)).map((wire) => wire.transactionCode)).toEqual(['TC-A']);

    await taken(w, 'TC-C', deviceId);
    await w.ledger.hold(key('TC-C'), CONTEXT);
    expect((await refusal(w.ledger.markSaleCreated(null, key('TC-C'), w.sale().orderId))).code).toBe('BOUND_ELSEWHERE');
    expect(w.row('TC-C')).toMatchObject({ state: 'UNBOUND', holdKey: CONTEXT });
  });
});

describe('a store that keeps no holds', () => {
  function bare(): World['ledger'] {
    const w = world();
    const { findHeld: _dropped, ...store } = w.captures.store;
    void _dropped;
    return createTerminalCaptureLedger({ store: () => store, directory: w.directory, sales: w.sales, maxAmountCents: 1_000_000, unboundRefundAfterMs: DAY, now: () => NOW });
  }

  it('says so, and refuses hold and findHeld with nothing written', async () => {
    const ledger = bare();
    expect(ledger.holdsReady).toBe(false);
    expect(world().ledger.holdsReady).toBe(true);
    await expect(ledger.hold(key(), CONTEXT)).rejects.toThrow('keeps no holds');
    await expect(ledger.findHeld(TENANT, CONTEXT)).rejects.toThrow('keeps no holds');
  });
});

describe('the Prisma store’s holds are opt-in', () => {
  const ROW = { id: 'c1', clientId: 't', transactionCode: 'TC', kind: 'CREDIT', amountCents: 1, state: 'UNBOUND', source: 'DEVICE', holdKey: null };

  function fake() {
    const delegate = {
      createMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ROW),
      findMany: vi.fn(async () => [ROW]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    const client = { terminalCapture: delegate, $executeRaw: vi.fn(async () => 0) } as unknown as PrismaTerminalCaptureClient;
    return { client, delegate };
  }

  it('without { holds: true } never names the column and answers no findHeld', async () => {
    const { client, delegate } = fake();
    const store = createPrismaTerminalCaptureStore(client);
    await store.find('t', 'TC');
    await store.writeIfUnchanged({ id: 'c1', state: 'UNBOUND', orderId: null, refundFlaggedAt: null, refundClearedAt: null }, { state: 'BOUND' });

    expect(store.findHeld).toBeUndefined();
    expect(delegate.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: CAPTURE_SELECT }));
    expect(delegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', state: 'UNBOUND', orderId: null, refundFlaggedAt: null, refundClearedAt: null },
      data: { state: 'BOUND' },
    });
  });

  it('findUnclaimed leaves held rows out only on a store that keeps holds; without, the column is never named', async () => {
    const off = fake();
    await createPrismaTerminalCaptureStore(off.client).findUnclaimed('t', ['d1']);
    const on = fake();
    await createPrismaTerminalCaptureStore(on.client, { holds: true }).findUnclaimed('t', ['d1']);
    const NOT_OWED_BACK = [{ refundFlaggedAt: null }, { refundClearedAt: { not: null } }, { refundReason: 'UNBOUND_TIMEOUT' }];

    expect(off.delegate.findMany).toHaveBeenCalledWith({
      where: { clientId: 't', deviceId: { in: ['d1'] }, state: 'UNBOUND', OR: NOT_OWED_BACK },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      select: CAPTURE_SELECT,
    });
    expect(on.delegate.findMany).toHaveBeenCalledWith({
      where: { clientId: 't', deviceId: { in: ['d1'] }, state: 'UNBOUND', holdKey: null, OR: NOT_OWED_BACK },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      select: CAPTURE_HOLD_SELECT,
    });
  });

  it('with { holds: true } selects the hold, puts it in the write predicate, and reads one context in one statement', async () => {
    const { client, delegate } = fake();
    const storeFor = prismaTerminalCaptureStoreFor(client, { holds: true });
    const store = storeFor();
    await store.find('t', 'TC');
    await store.writeIfUnchanged({ id: 'c1', state: 'UNBOUND', orderId: null, refundFlaggedAt: null, refundClearedAt: null, holdKey: null }, { holdKey: 'ctx' });
    await store.findHeld?.('t', 'ctx');

    expect(delegate.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: CAPTURE_HOLD_SELECT }));
    expect(delegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', state: 'UNBOUND', orderId: null, refundFlaggedAt: null, refundClearedAt: null, holdKey: null },
      data: { holdKey: 'ctx' },
    });
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
    expect(delegate.findMany).toHaveBeenCalledWith({
      where: { clientId: 't', holdKey: 'ctx', state: 'UNBOUND', OR: [{ refundFlaggedAt: null }, { refundClearedAt: { not: null } }] },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      select: CAPTURE_HOLD_SELECT,
    });
  });
});
