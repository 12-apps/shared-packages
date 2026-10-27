/* eslint-disable test-flakiness/no-database-operations --
   the database IS the subject: the compare-and-set below is only as good as
   Postgres's own answer to `WHERE updated_at = $read`, which a fake cannot give. */
/**
 * FUT-4072 — the supersede mark over the SHIPPED Prisma charge store, in a real
 * Postgres (PGlite) built by the shipped migrations.
 *
 * Every write to a charge row is a compare-and-set on its `updated_at` (the
 * row's version). The package's own suite pins that against a fake delegate;
 * this one pins what a fake cannot: that the column Prisma maintains with
 * `@updatedAt` round-trips exactly enough for `WHERE updated_at = <what was
 * read>` to match, and moves on `updateMany`, so a writer that read a row
 * before another one landed is refused and re-merges instead of erasing it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPrismaChargeStore,
  type ChargeSnapshot,
  type MerchantRef,
} from '@12-apps/payments-backend';

import { createPrismaDatabase, type HarnessPrismaClient } from '../src/prisma';

let db: Awaited<ReturnType<typeof createPrismaDatabase>>;
let prisma: HarnessPrismaClient;

beforeAll(async () => {
  db = await createPrismaDatabase();
  prisma = db.prisma;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'loja-supersede' };
const MARK = { at: '2026-10-27T12:00:00.000Z', replacedBy: 'NEW', why: 'VOID_UNSUPPORTED' as const };

type Delegate = Parameters<typeof createPrismaChargeStore>[0];

/** The real delegate, with each queued stale row answering one `findUnique` first. */
function staleReads(real: Delegate, queued: unknown[]): Delegate {
  // Bound one by one: a generated model delegate is not a plain object to spread.
  return {
    findUnique: (async (args: Parameters<Delegate['findUnique']>[0]) =>
      queued.shift() ?? real.findUnique(args)) as Delegate['findUnique'],
    count: real.count.bind(real),
    findMany: real.findMany.bind(real),
    create: real.create.bind(real),
    update: real.update.bind(real),
    updateMany: real.updateMany.bind(real),
  };
}

function link(id: string): ChargeSnapshot {
  return {
    provider: 'cascata',
    providerChargeId: id,
    reference: `order-${id}`,
    status: 'PENDING',
    amount: { amountCents: 4250, currency: 'BRL' },
    method: 'PIX',
    hostedCheckoutUrl: `https://cascata.example/${id}`,
  };
}

describe('the supersede mark over the shipped Prisma store', () => {
  it('takes the row out of listPayable and survives a later PAID refresh', async () => {
    const store = createPrismaChargeStore(prisma['paymentCharge'] as Delegate);
    await store.create({ merchant: MERCHANT, reference: 'order-A', snapshot: link('A') });

    await store.markSuperseded!(MERCHANT, 'cascata', 'A', MARK);
    const payable = await store.listPayable({ merchant: MERCHANT, reference: 'order-A' });
    await store.upsertByProviderChargeId(MERCHANT, { ...link('A'), status: 'PAID' });

    expect(payable).toEqual([]);
    const row = await store.findByProviderChargeId('cascata', 'A');
    expect(row?.snapshot.status).toBe('PAID');
    expect(row?.snapshot.superseded).toEqual(MARK);
  });

  it('a webhook that read the row before the mark re-merges instead of erasing it', async () => {
    const real = prisma['paymentCharge'] as Delegate;
    const store = createPrismaChargeStore(real);
    await store.create({ merchant: MERCHANT, reference: 'order-B', snapshot: link('B') });
    const before = await real.findUnique({ where: { provider_providerChargeId: { provider: 'cascata', providerChargeId: 'B' } } });
    await store.markSuperseded!(MERCHANT, 'cascata', 'B', MARK);
    await createPrismaChargeStore(staleReads(real, [before])).upsertByProviderChargeId(MERCHANT, { ...link('B'), status: 'PAID' });

    const row = await store.findByProviderChargeId('cascata', 'B');
    expect(row?.snapshot.status).toBe('PAID');
    expect(row?.snapshot.superseded).toEqual(MARK);
  });

  it('a mark that read the row before a payment never rolls the payment back', async () => {
    const real = prisma['paymentCharge'] as Delegate;
    const store = createPrismaChargeStore(real);
    await store.create({ merchant: MERCHANT, reference: 'order-C', snapshot: link('C') });
    const before = await real.findUnique({ where: { provider_providerChargeId: { provider: 'cascata', providerChargeId: 'C' } } });
    await store.upsertByProviderChargeId(MERCHANT, { ...link('C'), status: 'PAID' });
    await createPrismaChargeStore(staleReads(real, [before])).markSuperseded!(MERCHANT, 'cascata', 'C', MARK);

    const row = await store.findByProviderChargeId('cascata', 'C');
    expect(row?.snapshot.status).toBe('PAID');
    expect(row?.snapshot.superseded).toEqual(MARK);
  });
});
