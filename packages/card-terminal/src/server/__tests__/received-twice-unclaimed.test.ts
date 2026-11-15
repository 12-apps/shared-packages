import { describe, expect, it, vi } from 'vitest';

import { createTerminalLegs } from '../legs';
import { createTerminalCaptureLedger } from '../ledger';
import { CaptureError, PACKAGE_REFUND_REASONS, UNBOUND_ONLY_REASONS, notBoundReasonOf } from '../model';
import { CAPTURE_SELECT, createPrismaTerminalCaptureStore, type PrismaTerminalCaptureClient } from '../prisma-store';
import { DAY, NOW, OTHER_TENANT, TENANT, capture, refusal, world, type World } from './world';

/**
 * FUT-4996 (D7), the package half of `./terminal` beside the contract's own
 * file: the `RECEIVED_TWICE` refund (State 4), the `CONTENDED` answer a sale
 * path gives (R43), and the captures a counter may still use after a reload
 * (State 3, R18).
 */

function legsOf(w: World) {
  return createTerminalLegs({ ledger: w.ledger, directory: w.directory, now: () => NOW });
}

/** A capture BOUND to a fresh sale. */
async function bound(w: World, code: string) {
  await w.ledger.record(capture({ transactionCode: code }));
  const target = w.sale();
  await w.ledger.bind(null, TENANT, [code], target);
  return target;
}

describe('RECEIVED_TWICE: a capture the operator gives back after the leg was paid another way', () => {
  it('is a package reason, and only fits a capture no sale holds', () => {
    expect(PACKAGE_REFUND_REASONS).toContain('RECEIVED_TWICE');
    expect(UNBOUND_ONLY_REASONS.has('RECEIVED_TWICE')).toBe(true);
  });

  it('flags an UNBOUND capture once; a second flag writes nothing', async () => {
    const w = world();
    await w.ledger.record(capture());

    await expect(w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'RECEIVED_TWICE')).resolves.toEqual({ flagged: true });
    await expect(w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'RECEIVED_TWICE')).resolves.toEqual({ flagged: false });
    expect(w.row('TC-0001')).toMatchObject({ refundReason: 'RECEIVED_TWICE', refundFlaggedAt: NOW, state: 'UNBOUND' });
  });

  it('R49: on a capture a sale holds it is NOT_UNBOUND and nothing is written: money is the sale’s or owed back, never both', async () => {
    const w = world();
    await bound(w, 'TC-0001');

    expect((await refusal(w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'RECEIVED_TWICE'))).code).toBe('NOT_UNBOUND');
    expect(w.row('TC-0001')).toMatchObject({ state: 'BOUND', refundFlaggedAt: null, refundReason: null });
  });

  it('once flagged, a bind refuses it as FLAGGED: the money is owed back', async () => {
    const w = world();
    await w.ledger.record(capture());
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'RECEIVED_TWICE');

    expect((await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], w.sale()))).code).toBe('FLAGGED');
  });
});

describe("the host's own unbound-only reasons", () => {
  function ledgerWith(w: World, unboundOnlyReasons?: readonly string[]) {
    return createTerminalCaptureLedger({
      store: w.captures.storeFor,
      directory: w.directory,
      sales: w.sales,
      maxAmountCents: 100_000_000,
      unboundRefundAfterMs: DAY,
      now: () => NOW,
      ...(unboundOnlyReasons === undefined ? {} : { unboundOnlyReasons }),
    });
  }

  it('refuses a host-named unbound-only reason on a held capture, and flags it on an UNBOUND one', async () => {
    const w = world();
    await bound(w, 'TC-0001');
    await w.ledger.record(capture({ transactionCode: 'TC-0002' }));
    const ledger = ledgerWith(w, ['TOTAL_REDUCED']);

    expect((await refusal(ledger.flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'TOTAL_REDUCED'))).code).toBe('NOT_UNBOUND');
    await expect(ledger.flag({ clientId: TENANT, transactionCode: 'TC-0002' }, 'TOTAL_REDUCED')).resolves.toEqual({ flagged: true });
  });

  it('without them, a host reason flags whatever holds the capture, as before', async () => {
    const w = world();
    await bound(w, 'TC-0001');

    await expect(ledgerWith(w).flag({ clientId: TENANT, transactionCode: 'TC-0001' }, 'TOTAL_REDUCED')).resolves.toEqual({ flagged: true });
  });
});

describe('R43: CONTENDED is its own answer, never BOUND_ELSEWHERE', () => {
  it('names a contended move CONTENDED, and keeps the other mappings', () => {
    expect(notBoundReasonOf(new CaptureError('CONTENDED', 'TC', ''))).toBe('CONTENDED');
    expect(notBoundReasonOf(new CaptureError('BOUND_ELSEWHERE', 'TC', ''))).toBe('BOUND_ELSEWHERE');
    expect(notBoundReasonOf(new CaptureError('NOT_FOUND', 'TC', ''))).toBe('BOUND_ELSEWHERE');
  });

  it('a sale path recording into a row that keeps changing answers CONTENDED', async () => {
    const w = world({ wrap: (store) => ({ ...store, writeIfUnchanged: async () => false }) });
    await w.ledger.record(capture());
    const legs = legsOf(w);

    expect(legs.refusalCodeOf(await refusal(w.ledger.bind(null, TENANT, ['TC-0001'], w.sale())))).toBe('CONTENDED');
  });
});

describe('R18: the captures a counter may still use', () => {
  it('lists UNBOUND captures of the named terminals that are not owed back, oldest first', async () => {
    const w = world();
    const mine = w.device();
    const other = w.device();
    const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    await w.ledger.record(capture({ transactionCode: 'NEW', deviceId: mine, capturedAt: at(1) }));
    await w.ledger.record(capture({ transactionCode: 'OLD', deviceId: mine, capturedAt: at(30) }));
    await w.ledger.record(capture({ transactionCode: 'TIMED-OUT', deviceId: mine, capturedAt: at(20) }));
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'TIMED-OUT' }, 'UNBOUND_TIMEOUT');
    await w.ledger.record(capture({ transactionCode: 'OWED', deviceId: mine, capturedAt: at(10) }));
    await w.ledger.flag({ clientId: TENANT, transactionCode: 'OWED' }, 'RECEIVED_TWICE');
    await w.ledger.record(capture({ transactionCode: 'OTHER-TERMINAL', deviceId: other }));
    await w.ledger.record(capture({ transactionCode: 'NO-TERMINAL' }));
    await w.ledger.record(capture({ transactionCode: 'HELD', deviceId: mine }));
    await w.ledger.bind(null, TENANT, ['HELD'], w.sale());

    const listed = await legsOf(w).unclaimed(TENANT, [mine]);

    expect(listed.map((wire) => wire.transactionCode)).toEqual(['OLD', 'TIMED-OUT', 'NEW']);
    expect(listed[0]).toMatchObject({ kind: 'CREDIT', amountCents: 2500, deviceId: mine, capturedAt: at(30).toISOString() });
  });

  it("never reaches another tenant's capture, and reads nothing for no terminal", async () => {
    const w = world();
    const theirs = w.device(OTHER_TENANT);
    await w.ledger.record(capture({ clientId: OTHER_TENANT, deviceId: theirs }));
    const findUnclaimed = vi.spyOn(w.captures.store, 'findUnclaimed');

    await expect(legsOf(w).unclaimed(TENANT, [theirs])).resolves.toEqual([]);
    await expect(legsOf(w).unclaimed(TENANT, [])).resolves.toEqual([]);
    expect(findUnclaimed).toHaveBeenCalledTimes(1);
  });

  it('the Prisma store asks it in ONE statement, the predicate in the statement', async () => {
    const findMany = vi.fn<(args: unknown) => Promise<never[]>>(async () => []);
    const client = { terminalCapture: { findMany }, $executeRaw: vi.fn() } as unknown as PrismaTerminalCaptureClient;

    await createPrismaTerminalCaptureStore(client).findUnclaimed(TENANT, ['d1', 'd2']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        clientId: TENANT,
        deviceId: { in: ['d1', 'd2'] },
        state: 'UNBOUND',
        OR: [{ refundFlaggedAt: null }, { refundClearedAt: { not: null } }, { refundReason: 'UNBOUND_TIMEOUT' }],
      },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      select: CAPTURE_SELECT,
    });
  });
});
