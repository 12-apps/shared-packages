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
 * A one-table delegate. `updateMany` checks and writes in one step, as SQL
 * does, on the row's `updatedAt` (and status, when asked) and moves
 * `updatedAt` on every write, as Prisma's `@updatedAt` does.
 * `control.staleOnce` makes the NEXT read answer a row as it was before another
 * writer landed — the window the compare-and-set exists for.
 */
function tableDelegate(): { delegate: ChargeDelegate; rows: Row[]; control: { staleOnce?: Row } } {
  const rows: Row[] = [];
  const control: { staleOnce?: Row } = {};
  const delegate: ChargeDelegate = {
    count: async () => rows.length,
    // Newest first, by insertion — every row here shares one `createdAt`.
    findMany: async ({ where }) =>
      rows
        .filter((r) => !('status' in where) || typeof where.status !== 'string' || r.status === where.status)
        .reverse(),
    findUnique: async ({ where }) => {
      if (!('provider_providerChargeId' in where)) return null;
      const { provider, providerChargeId } = where.provider_providerChargeId;
      const row = rows.find((r) => r.provider === provider && r.providerChargeId === providerChargeId);
      const stale = control.staleOnce;
      control.staleOnce = undefined;
      return stale ?? (row ? { ...row } : null);
    },
    create: async ({ data }) => {
      const row: Row = { ...data, id: `row_${rows.length + 1}`, createdAt: CREATED_AT, updatedAt: new Date(CREATED_AT) };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('missing row');
      Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = rows.find(
        (r) =>
          r.id === where.id &&
          r.updatedAt.getTime() === where.updatedAt.getTime() &&
          (where.status === undefined || r.status === where.status),
      );
      if (row) Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
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

  it('the status poll skips a superseded row and follows the charge the buyer holds', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: { ...LINK, status: 'PAID' } });
    await store.create({
      merchant: TENANT,
      reference: 'order-1--1',
      snapshot: { ...LINK, providerChargeId: 'NEW', reference: 'order-1--1' },
    });

    await store.markSuperseded!(TENANT, 'hosted', 'NEW', { ...MARK, replacedBy: 'LINK' });

    expect((await store.latestByReference(TENANT, 'order-1'))?.providerChargeId).toBe('LINK');
  });

  it('leaves another merchant\'s charge alone', async () => {
    const store = build();
    await store.create({ merchant: TENANT, reference: 'order-1', snapshot: LINK });

    await store.markSuperseded!(OTHER, 'hosted', 'LINK', MARK);

    expect(await store.listPayable(QUERY)).toHaveLength(1);
  });
});

/** A table holding LINK, and a store over it. */
async function linked() {
  const table = tableDelegate();
  const linkedStore = createPrismaChargeStore(table.delegate);
  await linkedStore.create({ merchant: TENANT, reference: 'order-1', snapshot: { ...LINK, settlementHints: { slug: 's' } } });
  return { table, store: linkedStore, row: () => table.rows[0] as Row, snapshot: () => table.rows[0]?.snapshot as ChargeSnapshot };
}

describe('Prisma charge writes are a compare-and-set on the row version', () => {
  it('a payment that lands between the mark read and its write is not rolled back', async () => {
    const { table, store, row, snapshot } = await linked();
    const before = { ...row() };
    await store.upsertByProviderChargeId(TENANT, { ...LINK, status: 'PAID' });
    table.control.staleOnce = before;

    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);

    expect(row().status).toBe('PAID');
    expect(snapshot().superseded).toEqual(MARK);
  });

  it('a webhook that read the row BEFORE the mark keeps the mark when it writes PAID', async () => {
    const { table, store, row, snapshot } = await linked();
    const before = { ...row() };
    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);
    table.control.staleOnce = before;

    await store.upsertByProviderChargeId(TENANT, { ...LINK, status: 'PAID' });

    expect(row().status).toBe('PAID');
    expect(snapshot().superseded).toEqual(MARK);
  });

  it('a mark that read the row BEFORE a same-status refresh keeps that refresh', async () => {
    const { table, store, snapshot } = await linked();
    const before = { ...(table.rows[0] as Row) };
    await store.upsertByProviderChargeId(TENANT, { ...LINK, settlementHints: { transactionNsu: 'N1' } });
    table.control.staleOnce = before;

    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);

    expect(snapshot().settlementHints).toEqual({ slug: 's', transactionNsu: 'N1' });
    expect(snapshot().superseded).toEqual(MARK);
  });

  it('a refresh that read the row BEFORE the mark keeps both', async () => {
    const { table, store, snapshot } = await linked();
    const before = { ...(table.rows[0] as Row) };
    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);
    table.control.staleOnce = before;

    await store.upsertByProviderChargeId(TENANT, { ...LINK, settlementHints: { transactionNsu: 'N1' } });

    expect(snapshot().settlementHints).toEqual({ slug: 's', transactionNsu: 'N1' });
    expect(snapshot().superseded).toEqual(MARK);
  });

  it('the first mark stands', async () => {
    const { store, snapshot } = await linked();

    await store.markSuperseded!(TENANT, 'hosted', 'LINK', MARK);
    await store.markSuperseded!(TENANT, 'hosted', 'LINK', { ...MARK, replacedBy: 'LATER' });

    expect(snapshot().superseded).toEqual(MARK);
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
