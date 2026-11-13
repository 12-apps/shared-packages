import { afterEach, describe, expect, it, vi } from 'vitest';

import { reconcilePendingCharges, resetSweepWarnings } from '../core/payable-sweep';
import type { ChargeSnapshot, MerchantRef } from '../core/types';
import { createMemoryChargeStore } from '../memory';

/**
 * A charge the sweep cannot reconcile is warned about ONCE per process; every
 * later pass logs it at info (FUT-3968: one stuck InfinitePay charge warned on
 * every sweep, 376 times in 14 days, and the error tracker's quota ran out).
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };
const NOW = new Date('2026-08-09T12:00:00.000Z');

async function storeWithStuckCharge(id: string) {
  const store = createMemoryChargeStore();
  const created = await store.create({
    merchant: TENANT,
    reference: 'order-1--0',
    snapshot: {
      provider: 'infinitepay',
      providerChargeId: id,
      status: 'PENDING',
      amount: { amountCents: 690, currency: 'BRL' },
      method: 'PIX',
      reference: 'order-1--0',
    } as ChargeSnapshot,
  });
  (created as { createdAt: Date }).createdAt = new Date(NOW.getTime() - 10 * 60_000);
  return store;
}

async function sweepOnce(store: Awaited<ReturnType<typeof storeWithStuckCharge>>) {
  const logWarn = vi.fn();
  const logInfo = vi.fn();
  const refreshCharge = vi.fn(async () => {
    throw new Error('charge not found');
  });
  await reconcilePendingCharges(
    { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), logWarn, logInfo },
    { now: NOW },
  );
  return { logWarn, logInfo };
}

afterEach(() => {
  resetSweepWarnings();
});

describe('pending-charge sweep: one warning per stuck charge', () => {
  it('warns on the first pass and logs the same failure at info on the next', async () => {
    const store = await storeWithStuckCharge('CHAR_stuck');

    const first = await sweepOnce(store);
    const second = await sweepOnce(store);

    expect(first.logWarn).toHaveBeenCalledTimes(1);
    expect(first.logWarn.mock.calls[0]?.[0]).toContain('CHAR_stuck');
    expect(second.logWarn).not.toHaveBeenCalled();
    expect(second.logInfo).toHaveBeenCalledWith(expect.stringContaining('CHAR_stuck'));
  });

  it('still warns about a different charge', async () => {
    await sweepOnce(await storeWithStuckCharge('CHAR_a'));
    const other = await sweepOnce(await storeWithStuckCharge('CHAR_b'));

    expect(other.logWarn).toHaveBeenCalledWith(expect.stringContaining('CHAR_b'));
  });
});
