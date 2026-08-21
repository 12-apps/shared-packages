// @vitest-environment node
/**
 * The serializable quota guard — the half of enforcement that runs INSIDE the
 * write transaction, for ceilings a race must never overrun (seats, stock
 * locations, domains).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createWithinQuota,
  isSerializationFailure,
  QuotaRaceError,
  QuotaRecountError,
} from '../quota-guard';
import { PT_BR_ENTITLEMENTS_MESSAGES } from '../pt-BR';

/** The transaction client the callback receives — carries the counted model. */
interface Tx {
  count: (tenantId: string) => Promise<number>;
}

/**
 * Fresh mocks per test, held in ONE object so no binding named `counted` /
 * `transaction` exists outside a test body (the engine.test.ts pattern): a
 * real transaction that runs the callback against `tx`.
 */
function harness(used: number) {
  const ports = {
    counted: vi.fn<(tenantId: string) => Promise<number>>().mockResolvedValue(used),
    tx: undefined as unknown as Tx,
    transaction: vi.fn(async (fn: (txc: Tx) => Promise<unknown>) => fn(ports.tx)),
  };
  ports.tx = { count: ports.counted };
  const db = { $transaction: ports.transaction } as unknown as {
    $transaction: <T>(
      fn: (txc: Tx) => Promise<T>,
      opts: { isolationLevel: 'Serializable' },
    ) => Promise<T>;
  };
  return {
    ...ports,
    options: {
      db,
      tenantId: 'client-1',
      limit: 1 as number | 'unlimited' | null,
      count: (txc: Tx, tenantId: string) => txc.count(tenantId),
      message: 'Você atingiu o limite do seu plano.',
      raceMessage: PT_BR_ENTITLEMENTS_MESSAGES.quotaRaceRetry,
    },
  };
}

describe('createWithinQuota', () => {
  it('re-counts through the TRANSACTION client and runs the body under the ceiling', async () => {
    const { counted, tx, transaction, options } = harness(0);
    const body = vi.fn().mockResolvedValue('created');

    await expect(createWithinQuota(options, body)).resolves.toBe('created');

    // The count and the insert share the transaction — that is the atomicity.
    expect(counted).toHaveBeenCalledWith('client-1');
    expect(body).toHaveBeenCalledWith(tx);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it("refuses with the caller's 402 when the re-count finds the ceiling spent", async () => {
    // The route-level check passed with used=0, but a concurrent create
    // committed in between — the re-count is what catches it.
    const { options } = harness(1);
    const body = vi.fn();

    const error = await createWithinQuota(options, body).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuotaRecountError);
    expect((error as QuotaRecountError).status).toBe(402);
    expect((error as QuotaRecountError).message).toBe(options.message);
    expect(body).not.toHaveBeenCalled();
  });

  it('skips the re-count entirely for unlimited and boolean ceilings', async () => {
    const { counted, options } = harness(99);
    const body = vi.fn().mockResolvedValue('ok');

    await createWithinQuota({ ...options, limit: 'unlimited' }, body);
    await createWithinQuota({ ...options, limit: null }, body);

    expect(counted).not.toHaveBeenCalled();
    expect(body).toHaveBeenCalledTimes(2);
  });

  it('maps the loser of a serialization race to a retryable 409, not a 500', async () => {
    const { transaction, options } = harness(0);
    transaction.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2034' }));

    const error = await createWithinQuota(options, vi.fn()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuotaRaceError);
    expect((error as QuotaRaceError).status).toBe(409);
  });

  it('lets an unrelated failure propagate untouched', async () => {
    const { transaction, options } = harness(0);
    transaction.mockRejectedValue(new Error('connection reset'));

    await expect(createWithinQuota(options, vi.fn())).rejects.toThrow('connection reset');
  });
});

describe('isSerializationFailure', () => {
  it('recognizes the three shapes Postgres serialization aborts arrive in', () => {
    expect(isSerializationFailure({ code: 'P2034' })).toBe(true);
    expect(isSerializationFailure({ code: '40001' })).toBe(true);
    expect(
      isSerializationFailure(new Error('could not serialize access due to concurrent update')),
    ).toBe(true);
    expect(isSerializationFailure(new Error('duplicate key'))).toBe(false);
  });
});
