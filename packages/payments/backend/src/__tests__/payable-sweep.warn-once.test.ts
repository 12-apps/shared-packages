import { describe, expect, it, vi } from 'vitest';

import { reconcilePendingCharges, type PendingSweepDeps } from '../core/payable-sweep';
import type { ChargeSnapshot, MerchantRef } from '../core/types';
import { createMemoryChargeStore } from '../memory';

/**
 * A charge the sweep cannot reconcile is warned about ONCE per host binding
 * (the deps object a host supplies once); every later pass logs it at info (FUT-3968: one stuck InfinitePay charge warned on
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

/** One host binding: the deps a host builds once and passes on every pass. */
function hostBinding(store: Awaited<ReturnType<typeof storeWithStuckCharge>>) {
  const logWarn = vi.fn();
  const logInfo = vi.fn();
  const refreshCharge = vi.fn(async () => {
    throw new Error('charge not found');
  });
  const deps = { charges: store, gateway: { refreshCharge } as never, settle: vi.fn(), logWarn, logInfo } as PendingSweepDeps;
  return { deps, logWarn, logInfo };
}

describe('pending-charge sweep: one warning per stuck charge', () => {
  it('warns on the first pass and logs the same failure at info on the next', async () => {
    const { deps, logWarn, logInfo } = hostBinding(await storeWithStuckCharge('CHAR_stuck'));

    await reconcilePendingCharges(deps, { now: NOW });
    await reconcilePendingCharges(deps, { now: NOW });

    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn.mock.calls[0]?.[0]).toContain('CHAR_stuck');
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('CHAR_stuck'));
  });

  it('still warns about a different charge, and a second binding starts with none warned', async () => {
    const first = hostBinding(await storeWithStuckCharge('CHAR_a'));
    await reconcilePendingCharges(first.deps, { now: NOW });
    const second = hostBinding(await storeWithStuckCharge('CHAR_a'));
    await reconcilePendingCharges(second.deps, { now: NOW });

    expect(first.logWarn).toHaveBeenCalledTimes(1);
    expect(second.logWarn).toHaveBeenCalledTimes(1);
  });
});
