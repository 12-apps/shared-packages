import { describe, expect, it } from 'vitest';

import { createTerminalLegs } from '../legs';
import { CaptureError } from '../model';
import { NOW, OTHER_TENANT, TENANT, refusal, wire, world, type World } from './world';

/**
 * A sale's terminal legs against the in-memory store. Ported from the origin
 * host's sale-with-terminal-legs suite, at the level of the decisions it
 * makes: the look-up before anything is written, recording before the sale,
 * the create mark, the settle's binding, the replay of a twin's settle, and
 * the captures a sale whose settle failed left behind.
 */

function legsOf(w: World) {
  return createTerminalLegs({ ledger: w.ledger, directory: w.directory, now: () => NOW });
}

/** A sale written and settled with these captures, as a creating path does it. */
async function settle(w: World, captures: ReturnType<typeof wire>[]) {
  const subject = legsOf(w);
  const target = w.sale();
  expect(await subject.recordStation(TENANT, captures)).toBeNull();
  await subject.markCreatedIn(null, TENANT, captures, target.orderId);
  await subject.bindingFor(TENANT, target.orderId, captures)?.bind(null, target.paymentId);
  return target;
}

describe('the look-up before anything is written', () => {
  it('names no sale for fresh codes and the one sale codes are held by', async () => {
    const w = world();
    const legs = legsOf(w);
    await expect(legs.held(TENANT, [wire()])).resolves.toEqual({ ok: true, orderId: null, records: [] });

    const target = await settle(w, [wire()]);

    await expect(legs.held(TENANT, [wire()])).resolves.toMatchObject({ ok: true, orderId: target.orderId });
  });

  it('refuses a code recorded with another amount or kind as CONFLICT', async () => {
    const w = world();
    await w.ledger.record({ ...wire(), clientId: TENANT, source: 'DEVICE', capturedAt: NOW });
    const legs = legsOf(w);

    await expect(legs.held(TENANT, [wire({ amountCents: 2600 })])).resolves.toEqual({ ok: false, code: 'CONFLICT' });
    await expect(legs.held(TENANT, [wire({ kind: 'PIX' })])).resolves.toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('refuses a code one terminal recorded and the station sends as another terminal’s as CONFLICT', async () => {
    const w = world();
    const one = w.device();
    const two = w.device();
    await w.ledger.record({ ...wire(), clientId: TENANT, source: 'DEVICE', capturedAt: NOW, deviceId: one });

    await expect(legsOf(w).held(TENANT, [wire({ deviceId: two })])).resolves.toEqual({ ok: false, code: 'CONFLICT' });
    await expect(legsOf(w).held(TENANT, [wire({ deviceId: one })])).resolves.toMatchObject({ ok: true });
  });

  it("refuses a terminal that is not the tenant's as DEVICE_UNKNOWN", async () => {
    const w = world();
    await expect(legsOf(w).held(TENANT, [wire({ deviceId: w.device(OTHER_TENANT) })])).resolves.toEqual({ ok: false, code: 'DEVICE_UNKNOWN' });
  });

  it('refuses a capture flagged for a refund a bind would refuse as FLAGGED, but not one the sweep flagged', async () => {
    const w = world();
    const record = (code: string) => w.ledger.record({ ...wire({ transactionCode: code }), clientId: TENANT, source: 'DEVICE', capturedAt: NOW });
    await record('CANCELLED');
    await record('TIMED-OUT');
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'CANCELLED' }, 'SALE_NOT_CREATED', NOW);
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TIMED-OUT' }, 'UNBOUND_TIMEOUT', NOW);

    await expect(legsOf(w).held(TENANT, [wire({ transactionCode: 'CANCELLED' })])).resolves.toEqual({ ok: false, code: 'FLAGGED' });
    await expect(legsOf(w).held(TENANT, [wire({ transactionCode: 'TIMED-OUT' })])).resolves.toMatchObject({ ok: true });
  });

  it('refuses codes held by two different sales as BOUND_ELSEWHERE', async () => {
    const w = world();
    await settle(w, [wire({ transactionCode: 'A' })]);
    await settle(w, [wire({ transactionCode: 'B' })]);

    await expect(legsOf(w).held(TENANT, [wire({ transactionCode: 'A' }), wire({ transactionCode: 'B' })])).resolves.toEqual({
      ok: false,
      code: 'BOUND_ELSEWHERE',
    });
  });
});

describe('a settle of an existing sale', () => {
  it('proceeds with no read for a sale with no terminal leg, and for codes no sale holds', async () => {
    const w = world();
    const legs = createTerminalLegs({
      ledger: { ...w.ledger, findByCodes: () => Promise.reject(new Error('read')) },
      directory: w.directory,
    });
    await expect(legs.heldForSale(TENANT, 'any', [])).resolves.toEqual({ kind: 'PROCEED' });
    await expect(legsOf(w).heldForSale(TENANT, 'any', [wire()])).resolves.toEqual({ kind: 'PROCEED' });
  });

  it('answers ALL_BOUND when every code is bound to this sale, and refuses another sale', async () => {
    const w = world();
    const target = await settle(w, [wire()]);

    await expect(legsOf(w).heldForSale(TENANT, target.orderId, [wire()])).resolves.toEqual({ kind: 'ALL_BOUND' });
    await expect(legsOf(w).heldForSale(TENANT, 'another-sale', [wire()])).resolves.toEqual({ kind: 'REFUSED', code: 'BOUND_ELSEWHERE' });
  });

  it('proceeds for captures only created for this sale (its settle failed), so that settle binds them', async () => {
    const w = world();
    const legs = legsOf(w);
    const target = w.sale();
    await legs.recordStation(TENANT, [wire()]);
    await legs.markCreatedIn(null, TENANT, [wire()], target.orderId);

    await expect(legs.heldForSale(TENANT, target.orderId, [wire()])).resolves.toEqual({ kind: 'PROCEED' });
    await legs.bindingFor(TENANT, target.orderId, [wire()])?.bind(null, target.paymentId);
    expect(w.row('TC-0001')).toMatchObject({ state: 'BOUND', paymentId: target.paymentId });
  });

  it('passes a look-up refusal through', async () => {
    const w = world();
    await expect(legsOf(w).heldForSale(TENANT, 'x', [wire({ deviceId: 'unknown' })])).resolves.toEqual({ kind: 'REFUSED', code: 'DEVICE_UNKNOWN' });
  });
});

describe('recording, marking and binding', () => {
  it('records before the sale under the station, clamped to now, and answers a race as its code', async () => {
    const w = world();
    const legs = legsOf(w);

    expect(await legs.recordStation(TENANT, [wire({ capturedAt: '2026-11-04T00:00:00.000Z' })])).toBeNull();
    expect(w.row('TC-0001')).toMatchObject({ source: 'STATION', state: 'UNBOUND', capturedAt: NOW });
    expect(await legs.recordStation(TENANT, [wire({ amountCents: 1 })])).toBe('CONFLICT');
    expect(await legs.recordStation(TENANT, [wire({ transactionCode: 'X', deviceId: 'nobody' })])).toBe('DEVICE_UNKNOWN');
  });

  it('settles a two-part split once: both captures bound to the one payment row', async () => {
    const w = world();
    const target = await settle(w, [wire({ transactionCode: 'A' }), wire({ transactionCode: 'B', kind: 'PIX' })]);

    expect(w.rows().map((row) => [row.state, row.paymentId])).toEqual([
      ['BOUND', target.paymentId],
      ['BOUND', target.paymentId],
    ]);
  });

  it('rolls a second create back whole when another sale marked the capture first', async () => {
    const w = world();
    const legs = legsOf(w);
    const first = w.sale();
    const second = w.sale();
    await legs.recordStation(TENANT, [wire({ transactionCode: 'A' }), wire({ transactionCode: 'B' })]);
    await legs.markCreatedIn(null, TENANT, [wire({ transactionCode: 'B' })], first.orderId);

    const refused = await refusal(
      w.captures.transaction(() => legs.markCreatedIn(null, TENANT, [wire({ transactionCode: 'A' }), wire({ transactionCode: 'B' })], second.orderId)),
    );

    expect(refused.code).toBe('BOUND_ELSEWHERE');
    expect(w.row('A')).toMatchObject({ state: 'UNBOUND', orderId: null });
  });

  it('records, inside the settle, a capture nothing recorded yet, then binds it', async () => {
    const w = world();
    const target = w.sale();

    await legsOf(w).bindingFor(TENANT, target.orderId, [wire()])?.bind(null, target.paymentId);

    expect(w.row('TC-0001')).toMatchObject({ source: 'STATION', state: 'BOUND', paymentId: target.paymentId });
  });

  it('has no binding for a sale with no terminal leg', () => {
    expect(legsOf(world()).bindingFor(TENANT, 'sale', [])).toBeUndefined();
  });

  it('maps a move refusal to its code', () => {
    const legs = legsOf(world());
    expect(legs.refusalCodeOf(new CaptureError('FLAGGED', 'A', ''))).toBe('FLAGGED');
    expect(legs.refusalCodeOf(new CaptureError('DEVICE_MISMATCH', 'A', ''))).toBe('DEVICE_UNKNOWN');
    expect(legs.refusalCodeOf(new CaptureError('CONFLICT', 'A', ''))).toBe('CONFLICT');
    expect(legs.refusalCodeOf(new CaptureError('SALE_MISMATCH', 'A', ''))).toBe('BOUND_ELSEWHERE');
  });

  it('reads the captures off the legs, in leg order', () => {
    const legs = legsOf(world());
    expect(legs.capturesOf([{ tender: 'CASH' }, { tender: 'PIX', amountCents: 1, capture: wire({ transactionCode: 'Z' }) }])).toEqual([
      wire({ transactionCode: 'Z' }),
    ]);
  });
});

describe('after a lost claim, and what a failed settle left', () => {
  it('says the twin settled it when every code is bound to that sale, and not otherwise', async () => {
    const w = world();
    const legs = legsOf(w);
    const target = await settle(w, [wire()]);

    await expect(legs.boundAfterLostClaim(TENANT, [wire()], target.orderId)).resolves.toBe(true);
    await expect(legs.boundAfterLostClaim(TENANT, [wire(), wire({ transactionCode: 'NEW' })], target.orderId)).resolves.toBe(false);
    await expect(legs.boundAfterLostClaim(TENANT, [], target.orderId)).resolves.toBe(false);
  });

  it('lists the captures a failed settle left for its sale, oldest first, never owed-back ones or another sale’s', async () => {
    const w = world();
    const legs = legsOf(w);
    const failed = w.sale();
    const other = w.sale();
    const second = wire({ transactionCode: 'SECOND', capturedAt: '2026-11-03T14:59:00.000Z' });
    const first = wire({ transactionCode: 'FIRST', capturedAt: '2026-11-03T14:00:00.000Z' });
    await legs.recordStation(TENANT, [second, first, wire({ transactionCode: 'OWED' }), wire({ transactionCode: 'OTHER' })]);
    await legs.markCreatedIn(null, TENANT, [second, first, wire({ transactionCode: 'OWED' })], failed.orderId);
    await legs.markCreatedIn(null, TENANT, [wire({ transactionCode: 'OTHER' })], other.orderId);
    await w.ledger.flagSale(TENANT, other.orderId, 'SALE_CANCELLED');
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'OWED' }, 'PAYMENT_UNDONE', NOW);

    const held = await legs.createdCapturesFor(TENANT, [failed.orderId, other.orderId]);

    expect([...held.keys()]).toEqual([failed.orderId]);
    expect(held.get(failed.orderId)?.map((capture) => capture.transactionCode)).toEqual(['FIRST', 'SECOND']);
    expect(held.get(failed.orderId)?.[0]).toEqual({ ...first, deviceId: null });
    await expect(legs.createdCapturesFor(TENANT, [])).resolves.toEqual(new Map());
  });
});
