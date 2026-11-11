import { describe, expect, it, vi } from 'vitest';

import type { PaymentsGateway } from '../core/gateway';
import { reconcilePendingCharges } from '../core/payable-sweep';
import type { ChargeSnapshot, MerchantRef } from '../core/types';
import { createMemoryChargeStore } from '../memory';

/**
 * The pending-charge reconciliation sweep (FUT-761, ported from the
 * origin host). A paid charge whose webhook went missing was rescued
 * only while the buyer's own tab kept polling; this is the machine that asks
 * the provider after they leave. Pinned: the age window, the stub skip, the
 * PAID-only settle through the HOST's port, and that one unreachable
 * provider fails its item without failing the sweep.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const NOW = new Date('2026-08-09T12:00:00.000Z');

function snapshot(overrides: Partial<ChargeSnapshot>): ChargeSnapshot {
  return {
    provider: 'pagbank',
    providerChargeId: 'CHAR_1',
    status: 'PENDING',
    amount: { amountCents: 690, currency: 'BRL' },
    method: 'PIX',
    reference: 'order-1--0',
    ...overrides,
  } as ChargeSnapshot;
}

async function storeWith(
  charges: Array<{ id: string; ageMs: number; status?: ChargeSnapshot['status'] }>,
) {
  const store = createMemoryChargeStore();
  for (const [index, charge] of charges.entries()) {
    const created = await store.create({
      merchant: TENANT,
      reference: `order-${index}--0`,
      snapshot: snapshot({ providerChargeId: charge.id, status: charge.status ?? 'PENDING' }),
    });
    // The memory store stamps insertion time; rewind it to the scenario's age.
    (created as { createdAt: Date }).createdAt = new Date(NOW.getTime() - charge.ageMs);
  }
  return store;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('reconcilePendingCharges', () => {
  it('settles a PAID re-read through the host port and leaves a still-waiting one alone', async () => {
    const store = await storeWith([
      { id: 'CHAR_paid', ageMs: 10 * MIN },
      { id: 'CHAR_waiting', ageMs: 10 * MIN },
    ]);
    const refreshCharge = vi.fn(async (_m: MerchantRef, _p: string, id: string) =>
      snapshot({ providerChargeId: id, status: id === 'CHAR_paid' ? 'PAID' : 'PENDING' }),
    );
    const settle = vi.fn<(s: ChargeSnapshot, m: MerchantRef) => Promise<undefined>>(async () => undefined);

    const report = await reconcilePendingCharges(
      { charges: store, gateway: { refreshCharge } as never, settle },
      { now: NOW },
    );

    expect(report).toEqual({ checked: 2, settled: 1, failed: 0 });
    expect(settle).toHaveBeenCalledOnce();
    const [paid, merchant] = settle.mock.calls[0] ?? [];
    expect(paid?.providerChargeId).toBe('CHAR_paid');
    expect(merchant).toEqual(TENANT);
  });

  it('asks only inside the window: too-young and abandoned charges are not polled', async () => {
    const store = await storeWith([
      { id: 'CHAR_young', ageMs: 1 * MIN },
      { id: 'CHAR_old', ageMs: 25 * HOUR },
      { id: 'CHAR_due', ageMs: 10 * MIN },
    ]);
    const refreshCharge = vi.fn(async (_m: MerchantRef, _p: string, id: string) =>
      snapshot({ providerChargeId: id }),
    );

    const report = await reconcilePendingCharges(
      { charges: store, gateway: { refreshCharge } as never, settle: vi.fn() },
      { now: NOW },
    );

    expect(report.checked).toBe(1);
    expect(refreshCharge).toHaveBeenCalledOnce();
    expect(refreshCharge.mock.calls[0]?.[2]).toBe('CHAR_due');
  });

  it('skips stub charges — their simulated timeline belongs to the status poll', async () => {
    const store = await storeWith([{ id: 'stub_pix_1', ageMs: 10 * MIN }]);
    const refreshCharge = vi.fn();

    const report = await reconcilePendingCharges(
      { charges: store, gateway: { refreshCharge } as never, settle: vi.fn() },
      { now: NOW },
    );

    expect(report).toEqual({ checked: 0, settled: 0, failed: 0 });
    expect(refreshCharge).not.toHaveBeenCalled();
  });

  it('one unreachable provider fails its item, warns, and never fails the sweep', async () => {
    const store = await storeWith([
      { id: 'CHAR_down', ageMs: 10 * MIN },
      { id: 'CHAR_paid', ageMs: 11 * MIN },
    ]);
    const refreshCharge = vi.fn(async (_m: MerchantRef, _p: string, id: string) => {
      if (id === 'CHAR_down') throw new Error('provider unreachable');
      return snapshot({ providerChargeId: id, status: 'PAID' });
    });
    const warnings: string[] = [];

    const report = await reconcilePendingCharges(
      {
        charges: store,
        gateway: { refreshCharge } as never,
        settle: vi.fn(async () => undefined),
        logWarn: (line) => warnings.push(line),
      },
      { now: NOW },
    );

    expect(report).toEqual({ checked: 2, settled: 1, failed: 1 });
    expect(warnings[0]).toContain('CHAR_down');
    expect(warnings[0]).toContain('provider unreachable');
  });

  it('refuses loudly on a store without the pending read — never a silent no-op', async () => {
    await expect(
      reconcilePendingCharges(
        {
          charges: { countByReference: vi.fn(), listPayable: vi.fn(), latestByReference: vi.fn() },
          gateway: { refreshCharge: vi.fn() } as never,
          settle: vi.fn(),
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/listPendingCharges/);
  });

  it('hands a charge refused after acceptance to the host decline port (FUT-4401)', async () => {
    const store = await storeWith([
      { id: 'CHAR_refused', ageMs: 10 * MIN },
      { id: 'CHAR_waiting', ageMs: 10 * MIN },
    ]);
    const refreshCharge = vi.fn(async (_m: MerchantRef, _p: string, id: string) =>
      snapshot({ providerChargeId: id, status: id === 'CHAR_refused' ? 'DECLINED' : 'PENDING', method: 'CARD' }),
    );
    const settle = vi.fn(async () => undefined);
    const decline = vi.fn<(s: ChargeSnapshot, m: MerchantRef) => Promise<undefined>>(async () => undefined);

    const report = await reconcilePendingCharges(
      { charges: store, gateway: { refreshCharge } as never, settle, decline },
      { now: NOW },
    );

    expect(decline).toHaveBeenCalledOnce();
    expect(decline.mock.calls[0]?.[0]?.providerChargeId).toBe('CHAR_refused');
    expect(decline.mock.calls[0]?.[1]).toEqual(TENANT);
    expect(settle).not.toHaveBeenCalled();
    // Counted as ended, not left "waiting": the report says what the pass did.
    expect(report).toEqual({ checked: 2, settled: 0, failed: 0, declined: 1 });
  });

  it('leaves a refused charge waiting for a host with no decline port, as before', async () => {
    const store = await storeWith([{ id: 'CHAR_refused', ageMs: 10 * MIN }]);
    const refreshCharge = vi.fn(async () => snapshot({ providerChargeId: 'CHAR_refused', status: 'DECLINED' }));
    const settle = vi.fn(async () => undefined);

    const report = await reconcilePendingCharges({ charges: store, gateway: { refreshCharge } as never, settle }, { now: NOW });

    expect(settle).not.toHaveBeenCalled();
    expect(report).toEqual({ checked: 1, settled: 0, failed: 0 });
  });

  it('counts a decline port that throws as a failed item, never failing the sweep', async () => {
    const store = await storeWith([{ id: 'CHAR_refused', ageMs: 10 * MIN }]);
    const refreshCharge = vi.fn(async () => snapshot({ providerChargeId: 'CHAR_refused', status: 'DECLINED' }));
    const decline = vi.fn(async () => {
      throw new Error('db down');
    });

    const report = await reconcilePendingCharges(
      { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), decline },
      { now: NOW },
    );

    expect(report).toEqual({ checked: 1, settled: 0, failed: 1, declined: 0 });
  });

  // FUT-4268: a read with no HTTP answer is the network's, not the charge's.
  describe('a failure with no HTTP answer', () => {
    const transport = (): Error =>
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      });

    it('is logged at info, never as a warning, and still counts failed', async () => {
      const store = await storeWith([{ id: 'CHAR_down', ageMs: 10 * MIN }]);
      const refreshCharge = vi.fn<PaymentsGateway['refreshCharge']>(async () => {
        throw transport();
      });
      const logWarn = vi.fn();
      const logInfo = vi.fn();

      const report = await reconcilePendingCharges(
        { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), logWarn, logInfo },
        { now: NOW, finalTickMs: 5 * MIN },
      );

      expect(report).toEqual({ checked: 1, settled: 0, failed: 1 });
      expect(logWarn).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledOnce();
      expect(refreshCharge.mock.calls[0]?.[4]).toMatchObject({ transport: 'quiet' });
    });

    it('keeps the warning for an HTTP answer, exactly as before', async () => {
      const store = await storeWith([{ id: 'CHAR_404', ageMs: 10 * MIN }]);
      const refreshCharge = vi.fn(async () => {
        throw new Error('InfinitePay 404 Not Found');
      });
      const logWarn = vi.fn();
      const logInfo = vi.fn();

      await reconcilePendingCharges(
        { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), logWarn, logInfo },
        { now: NOW, finalTickMs: 5 * MIN },
      );

      expect(logWarn).toHaveBeenCalledOnce();
      expect(logInfo).not.toHaveBeenCalled();
    });

    it('warns once on the last pass before the 24 h cutoff, and not on the passes before it', async () => {
      const store = await storeWith([
        { id: 'CHAR_early', ageMs: 24 * HOUR - 6 * MIN },
        { id: 'CHAR_last', ageMs: 24 * HOUR - 4 * MIN },
      ]);
      const refreshCharge = vi.fn(async () => {
        throw transport();
      });
      const logWarn = vi.fn();
      const logInfo = vi.fn();

      await reconcilePendingCharges(
        { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), logWarn, logInfo },
        { now: NOW, finalTickMs: 5 * MIN },
      );

      expect(logWarn).toHaveBeenCalledOnce();
      expect(logWarn.mock.calls[0]?.[0]).toContain('CHAR_last');
      expect(logInfo).toHaveBeenCalledOnce();
      const modes = refreshCharge.mock.calls.map((call) => (call as unknown[])[4]);
      expect(modes).toEqual([
        expect.objectContaining({ transport: 'quiet' }),
        expect.objectContaining({ transport: 'final' }),
      ]);
    });

    it('has no last pass when the caller gives no interval (the young sweep)', async () => {
      const store = await storeWith([{ id: 'CHAR_edge', ageMs: 24 * HOUR - 1 * MIN }]);
      const refreshCharge = vi.fn(async () => {
        throw transport();
      });
      const logWarn = vi.fn();
      const logInfo = vi.fn();

      await reconcilePendingCharges(
        { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), logWarn, logInfo },
        { now: NOW },
      );

      expect(logWarn).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledOnce();
    });
  });

  it('gives each read a 15 s deadline through its signal, and settles a signal-ignoring read that answers PAID after it', async () => {
    const deadlines: Array<{ ms: number; controller: AbortController }> = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      deadlines.push({ ms, controller });
      return controller.signal;
    });
    try {
      const store = await storeWith([{ id: 'CHAR_slow', ageMs: 10 * MIN }]);
      // An adapter that ignores the signal and answers PAID after the deadline.
      const late: { answer: () => void } = { answer: () => undefined };
      const refreshCharge = vi.fn<PaymentsGateway['refreshCharge']>(
        (_m, _p, id) =>
          new Promise((resolve) => {
            late.answer = () => resolve(snapshot({ providerChargeId: id, status: 'PAID' }));
          }),
      );
      const settle = vi.fn(async () => undefined);

      const pass = reconcilePendingCharges(
        { charges: store, gateway: { refreshCharge } as never, settle },
        { now: NOW },
      );
      await vi.waitFor(() => expect(deadlines).toHaveLength(1));
      // The deadline fires first (an abort listener runs synchronously, so a
      // race on the signal would already have rejected); only THEN does the
      // ignoring adapter answer PAID.
      deadlines[0]?.controller.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      late.answer();
      const report = await pass;

      expect(deadlines[0]?.ms).toBe(15_000);
      expect(settle).toHaveBeenCalledOnce();
      expect(report).toEqual({ checked: 1, settled: 1, failed: 0 });
    } finally {
      timeout.mockRestore();
    }
  });
});
