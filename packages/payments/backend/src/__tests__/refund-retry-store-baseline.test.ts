import { describe, expect, it, vi } from 'vitest';

import type { NewRefundSeriesRow } from '../core/refund-series-store';
import { createPrismaRefundRetryStore, type RefundRetryDelegate } from '../prisma/refund-retry-store';

/**
 * The Prisma store keeps a part's baseline (FUT-4951) in `refunded_before_cents`
 * and `refunded_before_at`, and a row that never had one writes neither column,
 * so a host whose generated client predates the migration keeps working.
 */

const NEW_ROW: NewRefundSeriesRow = {
  merchant: { kind: 'TENANT', id: 'tenant-1' },
  provider: 'pagbank',
  providerChargeId: 'CHAR_1',
  reference: 'order-1',
  subject: 'part:1',
  boundTo: '1',
  amountCents: 509,
  cause: null,
  series: 1,
  attempt: 0,
  nextAt: '2026-11-18T15:00:00.000Z',
  claimedAt: null,
  exhausted: false,
  refusal: null,
  reported: false,
  settledAt: null,
  settledHow: null,
};

function delegate() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'row-1', version: 0 }));
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findUnique = vi.fn();
  const findMany = vi.fn();
  return { create, updateMany, findUnique, findMany, port: { create, updateMany, findUnique, findMany } as unknown as RefundRetryDelegate };
}

describe('the Prisma refund retry store and a part baseline (FUT-4951)', () => {
  it('a row with no baseline writes neither column, and reads back with none', async () => {
    const d = delegate();
    const row = await createPrismaRefundRetryStore(d.port).insert(NEW_ROW);
    expect(d.create.mock.calls[0]![0].data).not.toHaveProperty('refundedBeforeCents');
    expect(d.create.mock.calls[0]![0].data).not.toHaveProperty('refundedBeforeAt');
    expect(row).not.toHaveProperty('refundedBeforeCents');
  });

  it('a baseline is written behind the version and read back as ISO', async () => {
    const d = delegate();
    const store = createPrismaRefundRetryStore(d.port);
    const row = (await store.insert(NEW_ROW))!;
    await store.saveIf({ ...row, refundedBeforeCents: 1_200, refundedBeforeAt: '2026-11-18T15:00:01.000Z' }, 0);
    expect(d.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'row-1', version: 0 },
        data: expect.objectContaining({ refundedBeforeCents: 1_200, refundedBeforeAt: new Date('2026-11-18T15:00:01.000Z'), version: 1 }),
      }),
    );
    d.findUnique.mockResolvedValueOnce({ ...d.create.mock.calls[0]![0].data, id: 'row-1', version: 1, refundedBeforeCents: 1_200, refundedBeforeAt: new Date('2026-11-18T15:00:01.000Z') });
    expect(await store.find('pagbank', 'CHAR_1', 'part:1')).toMatchObject({ refundedBeforeCents: 1_200, refundedBeforeAt: '2026-11-18T15:00:01.000Z' });
  });
});
