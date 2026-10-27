import { describe, expect, it } from 'vitest';

import { createMemoryAttemptLedger, createMemoryChargeStore } from '../memory';
import { createPrismaChargeStore, type ChargeDelegate } from '../prisma/stores';
import type { ChargeSupersession } from '../core/supersession';
import type { ChargeSnapshot, MerchantRef } from '../core/types';
import { providersWalkedPast } from '../core/walk-history';
import { TENANT } from './fixtures';

/**
 * FUT-4072 — the supersede MARK, in both stores the package ships. A link a
 * checkout moved past and could not void is marked on its row, so it is never
 * offered back as the live charge (`listPayable`) and is retired exactly once;
 * the mark survives a later refresh, and never rolls back a payment that lands
 * while it is being written.
 */

const LINK: ChargeSnapshot = {
  provider: 'hosted',
  providerChargeId: 'LINK',
  reference: 'order-1',
  status: 'PENDING',
  amount: { amountCents: 4250, currency: 'BRL' },
  method: 'PIX',
  hostedCheckoutUrl: 'https://pay.example/LINK',
};
const MARK: ChargeSupersession = { at: '2026-10-27T12:00:00.000Z', replacedBy: 'NEW', why: 'VOID_UNSUPPORTED' };
const OTHER: MerchantRef = { kind: 'TENANT', id: 'someone-else' };
const CREATED_AT = new Date('2026-10-27T11:00:00Z');

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
 * A one-table delegate; `updateMany` checks and writes in one step, as SQL
 * does. `control.staleOnce` makes the NEXT read answer a row as it was before
 * a payment landed — the window the compare-and-set exists for.
 */
function tableDelegate(): { delegate: ChargeDelegate; rows: Row[]; control: { staleOnce?: Row } } {
  const rows: Row[] = [];
  const control: { staleOnce?: Row } = {};
  const delegate: ChargeDelegate = {
    count: async () => rows.length,
    findMany: async ({ where }) =>
      rows.filter((r) => !('status' in where) || typeof where.status !== 'string' || r.status === where.status),
    findUnique: async ({ where }) => {
      if (!('provider_providerChargeId' in where)) return null;
      const { provider, providerChargeId } = where.provider_providerChargeId;
      const row = rows.find((r) => r.provider === provider && r.providerChargeId === providerChargeId);
      const stale = control.staleOnce;
      control.staleOnce = undefined;
      return stale ?? (row ? { ...row } : null);
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
      return { count: row ? 1 : 0 };
    },
  };
  return { delegate, rows, control };
}

const stores = {
  prisma: () => createPrismaChargeStore(tableDelegate().delegate),
  memory: () => createMemoryChargeStore(),
};

const QUERY = { merchant: TENANT, reference: 'order-1', amount: LINK.amount };

describe.each(Object.entries(stores))('markSuperseded in the %s store', (_name, build) => {
  it('takes the row out of listPayable and keeps its status', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: LINK });

    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);

    expect(await store.listPayable(QUERY)).toEqual([]);
    const row = await store.findByProviderChargeId('hosted', 'LINK');
    expect(row?.snapshot.status).toBe('PENDING');
    expect(row?.snapshot.superseded).toEqual(MARK);
  });

  it('keeps the mark through a later refresh, so a payment of it still reads as superseded', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: LINK });
    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);

    await store.upsertByProviderChargeId(TENANT, { ...LINK, status: 'PAID', hostedCheckoutUrl: undefined });

    const row = await store.findByProviderChargeId('hosted', 'LINK');
    expect(row?.snapshot.status).toBe('PAID');
    expect(row?.snapshot.superseded).toEqual(MARK);
  });

  it('leaves another merchant\'s charge alone', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: LINK });

    await store.markSuperseded!(OTHER, 'hosted', 'LINK', MARK);

    expect(await store.listPayable(QUERY)).toHaveLength(1);
  });
});

describe('markSuperseded over Prisma never rolls a payment back', () => {
  it('marks the PAID row when the payment landed between its read and its write', async () => {
    const table = tableDelegate();
    const store = createPrismaChargeStore(table.delegate);
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: LINK });
    const before = { ...(table.rows[0] as Row) };
    Object.assign(table.rows[0] as Row, { status: 'PAID', snapshot: { ...LINK, status: 'PAID' } });
    table.control.staleOnce = before;

    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);

    expect(table.rows[0]?.status).toBe('PAID');
    expect((table.rows[0]?.snapshot as ChargeSnapshot).superseded).toEqual(MARK);
  });

});

describe('providersWalkedPast', () => {
  it('counts failovers and outage skips, never a skip about the request', async () => {
    const ledger = createMemoryAttemptLedger();
    const base = { merchant: TENANT, idempotencyKey: 'k', reference: 'order-1' };
    await ledger.record({ ...base, provider: 'down', attemptNo: 1, outcome: 'FAILED_OVER' });
    await ledger.record({
      ...base,
      provider: 'breaker',
      attemptNo: 2,
      outcome: 'SKIPPED',
      error: 'provider breaker skipped: recent failures indicate an outage',
    });
    await ledger.record({ ...base, provider: 'no-token', attemptNo: 3, outcome: 'SKIPPED', error: 'no instrument' });
    await ledger.record({ ...base, provider: 'hosted', attemptNo: 4, outcome: 'SUCCEEDED' });

    expect(await providersWalkedPast(ledger, TENANT, 'k')).toEqual(['down', 'breaker']);
  });
});
