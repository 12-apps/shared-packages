import { describe, expect, it, vi } from 'vitest';

import { reconcilePendingCharges } from '../core/payable-sweep';
import type { ChargeSnapshot, MerchantRef } from '../core/types';
import { createMemoryChargeStore } from '../memory';

/**
 * The pending-charge reconciliation sweep (FUT-761, ported from the
 * future-pay host). A paid charge whose webhook went missing was rescued
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
});
