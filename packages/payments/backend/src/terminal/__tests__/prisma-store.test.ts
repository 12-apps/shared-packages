import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_SELECT, createPrismaTerminalCaptureStore, prismaTerminalCaptureStoreFor, type PrismaTerminalCaptureClient } from '../prisma-store';
import { sqlSavepoint } from '../ports';

/**
 * The Prisma store issues ONE statement per method, with the predicate in the
 * statement — the guarantees rest on it — and the sweep is the origin host's
 * SQL verbatim. Pinned against a recording fake, since this package has no
 * database.
 */

const ROW = {
  id: 'c1',
  clientId: 't',
  transactionCode: 'TC',
  kind: 'CREDIT',
  amountCents: 1,
  state: 'UNBOUND',
  source: 'DEVICE',
  deviceId: null,
  orderId: null,
  paymentId: null,
  transactionId: null,
  hostNsu: null,
  authorizationCode: null,
  cardBrand: null,
  installments: null,
  terminalSerial: null,
  entryMode: null,
  capturedAt: new Date(0),
  refundFlaggedAt: null,
  refundReason: null,
  refundClearedAt: null,
};

function fake() {
  const delegate = {
    createMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 })),
    findUnique: vi.fn<(args: unknown) => Promise<typeof ROW>>(async () => ROW),
    findMany: vi.fn<(args: unknown) => Promise<(typeof ROW)[]>>(async () => [ROW]),
    updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 })),
  };
  const executeRaw = vi.fn<(query: TemplateStringsArray, ...values: unknown[]) => Promise<number>>(async () => 3);
  const client: PrismaTerminalCaptureClient = { terminalCapture: delegate, $executeRaw: executeRaw };
  return { client, delegate, executeRaw };
}

/** The origin host's sweep, line by line with the indentation trimmed; `?` marks each value. */
const HOST_SWEEP_SQL: readonly string[] = [
  '',
  'UPDATE "terminal_captures"',
  `SET "refund_flagged_at" = ?, "refund_reason" = 'UNBOUND_TIMEOUT', "updated_at" = ?`,
  'WHERE "id" IN (',
  'SELECT "id" FROM "terminal_captures"',
  `WHERE "state" = 'UNBOUND' AND "refund_flagged_at" IS NULL AND "captured_at" <= ?`,
  'AND "created_at" <= ?',
  'ORDER BY "captured_at" ASC, "id" ASC',
  'LIMIT ?)',
  `AND "state" = 'UNBOUND' AND "refund_flagged_at" IS NULL`,
];

const NOT_LIVE = [{ refundFlaggedAt: null }, { refundClearedAt: { not: null } }];
const flag = { at: new Date(5), reason: 'SALE_CANCELLED' };

describe('the Prisma capture store', () => {
  it('inserts with skipDuplicates and reads by the tenant-scoped unique key', async () => {
    const { client, delegate } = fake();
    const store = createPrismaTerminalCaptureStore(client);
    delegate.createMany.mockResolvedValueOnce({ count: 0 });

    await expect(store.insertIfAbsent({ ...ROW, kind: 'CREDIT', source: 'DEVICE' } as never)).resolves.toBe(false);
    expect(delegate.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ transactionCode: 'TC' })], skipDuplicates: true });
    await expect(store.find('t', 'TC')).resolves.toMatchObject({ id: 'c1' });
    expect(delegate.findUnique).toHaveBeenCalledWith({ where: { clientId_transactionCode: { clientId: 't', transactionCode: 'TC' } }, select: CAPTURE_SELECT });
  });

  it('writes a move only on the row as it was read (compare-and-set)', async () => {
    const { client, delegate } = fake();
    const seen = { id: 'c1', state: 'UNBOUND' as const, orderId: null, refundFlaggedAt: null, refundClearedAt: null };
    delegate.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(createPrismaTerminalCaptureStore(client).writeIfUnchanged(seen, { state: 'BOUND' })).resolves.toBe(false);
    expect(delegate.updateMany).toHaveBeenCalledWith({ where: seen, data: { state: 'BOUND' } });
  });

  it('completes only a JOURNAL row still awaiting its report', async () => {
    const { client, delegate } = fake();
    await createPrismaTerminalCaptureStore(client).completeJournalTrace('c1', { hostNsu: 'n' });
    expect(delegate.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', source: 'JOURNAL', transactionId: null, authorizationCode: null, terminalSerial: null },
      data: { hostNsu: 'n' },
    });
  });

  it('flags once: never over a live flag, UNBOUND only when asked, resetting the clear', async () => {
    const { client, delegate } = fake();
    const store = createPrismaTerminalCaptureStore(client);
    const data = { refundFlaggedAt: flag.at, refundReason: flag.reason, refundClearedAt: null };

    await store.flagIfNotLive('t', 'TC', flag, true);
    await store.flagIfNotLive('t', 'TC', flag, false);
    await expect(store.flagHeldBy('t', 'o1', flag)).resolves.toBe(1);

    expect(delegate.updateMany.mock.calls.map(([args]) => args)).toEqual([
      { where: { clientId: 't', transactionCode: 'TC', state: 'UNBOUND', OR: NOT_LIVE }, data },
      { where: { clientId: 't', transactionCode: 'TC', OR: NOT_LIVE }, data },
      { where: { clientId: 't', orderId: 'o1', OR: NOT_LIVE }, data },
    ]);
  });

  it("runs the origin host's sweep SQL verbatim, on both clocks, with its four values", async () => {
    const { client, executeRaw } = fake();
    const now = new Date(10);
    const cutoff = new Date(1);

    await expect(createPrismaTerminalCaptureStore(client).flagStaleUnbound(now, cutoff, 200)).resolves.toBe(3);

    const [strings, ...values] = executeRaw.mock.calls[0] ?? [];
    const lines = (strings as TemplateStringsArray).join('?').split('\n').map((line) => line.trim());
    expect(lines).toEqual(HOST_SWEEP_SQL);
    expect(values).toEqual([now, now, cutoff, cutoff, 200]);
  });

  it('reads the created captures of a list of sales, oldest first, and by code', async () => {
    const { client, delegate } = fake();
    const store = createPrismaTerminalCaptureStore(client);
    await store.findCreatedFor('t', ['o1']);
    await store.findMany('t', ['A']);
    expect(delegate.findMany.mock.calls.map(([args]) => args)).toEqual([
      { where: { clientId: 't', orderId: { in: ['o1'] }, state: 'ORDER_CREATED' }, orderBy: { capturedAt: 'asc' }, select: CAPTURE_SELECT },
      { where: { clientId: 't', transactionCode: { in: ['A'] } }, select: CAPTURE_SELECT },
    ]);
  });

  it("runs on the host's transaction when one is passed, on the lazily resolved root otherwise", async () => {
    const root = fake();
    const tx = fake();
    const storeFor = prismaTerminalCaptureStoreFor(async () => root.client);

    await storeFor(tx.client).find('t', 'TC');
    await storeFor().find('t', 'TC');

    expect(tx.delegate.findUnique).toHaveBeenCalledTimes(1);
    expect(root.delegate.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('the SQL savepoint', () => {
  it('opens, releases and rolls back to a named savepoint, and refuses a name that is not one', async () => {
    const sql: string[] = [];
    const tx = { $executeRawUnsafe: async (query: string) => void sql.push(query) };
    const savepoint = sqlSavepoint<typeof tx>('one_capture');

    await savepoint.open(tx);
    await savepoint.rollBack(tx);
    await savepoint.release(tx);

    expect(sql).toEqual(['SAVEPOINT one_capture', 'ROLLBACK TO SAVEPOINT one_capture', 'RELEASE SAVEPOINT one_capture']);
    expect(() => sqlSavepoint('x; DROP TABLE y')).toThrow(/savepoint name/);
  });
});
