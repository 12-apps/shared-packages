import { describe, expect, it } from 'vitest';

import type { ChargeSnapshot } from '../core/types';
import { createMemoryChargeStore } from '../memory';
import { createPrismaChargeStore, type ChargeDelegate } from '../prisma/stores';
import { TENANT } from './fixtures';

/**
 * `ChargeStore.transitionPending` — the compare-and-set a manual confirmation,
 * refusal and expiry race on. Two staff taps can both read PENDING; exactly one
 * may write. Pinned in BOTH stores the package ships, with the calls actually
 * concurrent: a sequential "the second one loses" test passes against the
 * read-then-write upsert too, and proves nothing.
 */

const PENDING: ChargeSnapshot = {
  provider: 'pixmanual',
  providerChargeId: 'pixmanual_order1',
  reference: 'order-1',
  status: 'PENDING',
  amount: { amountCents: 4250, currency: 'BRL' },
  method: 'PIX',
  pix: { qrText: '000201…', expiresAt: '2026-10-02T12:30:00.000Z' },
};

/** A fixed instant for the rows' timestamps, which nothing here reads. */
const CREATED_AT = new Date('2026-10-02T12:00:00Z');

interface Row {
  id: string;
  merchantKind: string;
  merchantId: string;
  provider: string;
  providerChargeId: string;
  reference: string;
  idempotencyKey: string | null;
  snapshot: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A one-table Prisma delegate. `updateMany` checks and writes in the same
 * synchronous step, as one SQL statement does, and yields before answering so
 * two callers interleave around it.
 */
function tableDelegate(): ChargeDelegate {
  const rows: Row[] = [];
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    count: async () => rows.length,
    findMany: async () => [],
    findUnique: async ({ where }) => {
      await tick();
      if (!('provider_providerChargeId' in where)) return null;
      const { provider, providerChargeId } = where.provider_providerChargeId;
      return rows.find((r) => r.provider === provider && r.providerChargeId === providerChargeId) ?? null;
    },
    create: async ({ data }) => {
      const row: Row = { ...data, id: `row_${rows.length + 1}`, createdAt: CREATED_AT, updatedAt: CREATED_AT };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('missing row');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id && r.status === where.status);
      if (row) Object.assign(row, data);
      await tick();
      return { count: row ? 1 : 0 };
    },
  };
}

const stores = {
  prisma: () => createPrismaChargeStore(tableDelegate()),
  memory: () => createMemoryChargeStore(),
};

describe.each(Object.entries(stores))('transitionPending in the %s store', (_name, build) => {
  it('applies to a PENDING row and reports the row as it now stands', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: PENDING });

    const outcome = await store.transitionPending!(TENANT, { ...PENDING, status: 'PAID' });

    expect(outcome.applied).toBe(true);
    expect(outcome.stored?.snapshot.status).toBe('PAID');
  });

  it('lets exactly one of two concurrent transitions apply', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: PENDING });

    const [paid, canceled] = await Promise.all([
      store.transitionPending!(TENANT, { ...PENDING, status: 'PAID' }),
      store.transitionPending!(TENANT, { ...PENDING, status: 'CANCELED' }),
    ]);

    expect([paid.applied, canceled.applied].filter(Boolean)).toHaveLength(1);
    const final = await store.findByProviderChargeId('pixmanual', 'pixmanual_order1');
    expect(final?.snapshot.status).toBe(paid.applied ? 'PAID' : 'CANCELED');
  });

  it('never moves a row that has left PENDING, and says what it is', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: PENDING });
    await store.transitionPending!(TENANT, { ...PENDING, status: 'CANCELED' });

    const late = await store.transitionPending!(TENANT, { ...PENDING, status: 'PAID' });

    expect(late.applied).toBe(false);
    expect(late.stored?.snapshot.status).toBe('CANCELED');
  });

  it('touches nothing for another merchant or an unknown charge', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: PENDING });

    const foreign = await store.transitionPending!({ kind: 'TENANT', id: 'other' }, { ...PENDING, status: 'PAID' });
    const unknown = await store.transitionPending!(TENANT, { ...PENDING, providerChargeId: 'nope', status: 'PAID' });

    expect(foreign).toEqual({ applied: false, stored: null });
    expect(unknown).toEqual({ applied: false, stored: null });
    expect((await store.findByProviderChargeId('pixmanual', 'pixmanual_order1'))?.snapshot.status).toBe('PENDING');
  });
});
