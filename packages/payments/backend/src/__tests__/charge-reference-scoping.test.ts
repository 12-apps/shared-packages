import { describe, expect, it, vi } from 'vitest';

import type { MerchantRef } from '../core/types';
import { createPrismaChargeStore, type ChargeDelegate } from '../prisma/stores';

/**
 * WHICH ROWS BELONG TO ONE ORDER — the `where` every charge read is built on
 * (FUT-760, taken over from the first adopting host).
 *
 * A charge is named after the host's reference, and an attempt after that
 * reference plus `--<n>`. Matching "this order's charges" therefore needs an
 * exact-or-suffix disjunction, and the suffix must carry the separator: a bare
 * `startsWith: 'ord_1'` also matches `ord_10`, a DIFFERENT order. Every read
 * here is scoped to one order's money, so a prefix that leaks into another's is
 * the one mistake none of them may make.
 *
 * This lived in the host while the host wrote its own queries. The store owns
 * the rule now, so the test follows it — otherwise the only assertion of a
 * money-scoping property would sit in a repository that no longer implements it.
 *
 * The merchant clause is pinned alongside it for the same reason: an order id
 * guessed from another tenant must not resolve a charge either.
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'acme' };

/** A delegate that records the `where` it was handed and returns nothing. */
function recordingDelegate(): {
  delegate: ChargeDelegate;
  counts: Array<Record<string, unknown>>;
  finds: Array<Record<string, unknown>>;
} {
  const counts: Array<Record<string, unknown>> = [];
  const finds: Array<Record<string, unknown>> = [];
  const delegate = {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      counts.push(where);
      return 0;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      finds.push(where);
      return [];
    }),
    findUnique: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as ChargeDelegate;
  return { delegate, counts, finds };
}

describe('charge reads are scoped to one order and one merchant', () => {
  it('matches the bare reference and every `--n` attempt of it', async () => {
    const { delegate, counts } = recordingDelegate();

    await createPrismaChargeStore(delegate).countByReference(TENANT, 'ord_1');

    expect(counts[0]).toEqual({
      merchantKind: 'TENANT',
      merchantId: 'acme',
      OR: [{ reference: 'ord_1' }, { reference: { startsWith: 'ord_1--' } }],
    });
  });

  it('cannot stray into an order whose id merely starts the same', async () => {
    const { delegate, counts } = recordingDelegate();

    await createPrismaChargeStore(delegate).countByReference(TENANT, 'ord_1');

    const or = (counts[0] as { OR: Array<{ reference: unknown }> }).OR;
    expect(or[0]).toEqual({ reference: 'ord_1' });
    expect(or[1]).toEqual({ reference: { startsWith: 'ord_1--' } });
    // The separator is what makes the prefix safe.
    expect('ord_10'.startsWith('ord_1--')).toBe(false);
  });

  it('carries the same order and merchant scope into the payable read', async () => {
    const { delegate, finds } = recordingDelegate();

    await createPrismaChargeStore(delegate).listPayable({
      merchant: TENANT,
      reference: 'ord_1',
      method: 'PIX',
      amount: { amountCents: 1000, currency: 'BRL' },
    });

    expect(finds[0]).toEqual({
      merchantKind: 'TENANT',
      merchantId: 'acme',
      OR: [{ reference: 'ord_1' }, { reference: { startsWith: 'ord_1--' } }],
      status: 'PENDING',
      method: 'PIX',
      amountCents: 1000,
      currency: 'BRL',
    });
  });

  /**
   * The reprice mirror: same scope, opposite amount test. Comparing cents
   * without the currency is how a 7500-centavo charge passes for a 7500-cent
   * one, so the currency must ride along with `amountNot` too.
   */
  it('narrows a superseded read by amountNot, currency included', async () => {
    const { delegate, finds } = recordingDelegate();

    await createPrismaChargeStore(delegate).listPayable({
      merchant: TENANT,
      reference: 'ord_1',
      method: 'PIX',
      amountNot: { amountCents: 800, currency: 'BRL' },
    });

    expect(finds[0]).toMatchObject({
      status: 'PENDING',
      method: 'PIX',
      amountCents: { not: 800 },
      currency: 'BRL',
    });
  });
});
