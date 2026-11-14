import type { CaptureKind, CaptureSource, CaptureState, TerminalCaptureRecord } from './model';
import type { CapturePatch, CaptureVersion, NewTerminalCapture, TerminalCaptureStore, TerminalCaptureStoreFor } from './ports';

/**
 * The capture table over a host's Prisma `terminalCapture` model. Duck-typed
 * like its siblings: the host passes its client, or its transaction client,
 * and nothing here imports Prisma.
 *
 * Every method is ONE statement, which is what the engine's guarantees rest
 * on: the insert is `createMany({ skipDuplicates })` (`ON CONFLICT DO NOTHING`,
 * so a duplicate never aborts the caller's transaction), and every write after
 * it is an `updateMany` whose `where` IS the predicate — the database decides
 * which of two writers wins, and the loser writes nothing.
 *
 * The table it expects is `terminal_captures`, keyed unique on
 * `(client_id, transaction_code)`, with a partial index on the UNBOUND rows by
 * `captured_at` for the sweep; the column names are the ones below.
 */

export const CAPTURE_SELECT = {
  id: true,
  clientId: true,
  transactionCode: true,
  kind: true,
  amountCents: true,
  state: true,
  source: true,
  deviceId: true,
  orderId: true,
  paymentId: true,
  transactionId: true,
  hostNsu: true,
  authorizationCode: true,
  cardBrand: true,
  installments: true,
  terminalSerial: true,
  entryMode: true,
  capturedAt: true,
  refundFlaggedAt: true,
  refundReason: true,
  refundClearedAt: true,
} as const;

/** The row as Prisma returns it under {@link CAPTURE_SELECT}: the sets are TEXT columns held by CHECKs. */
export interface CaptureRow extends Omit<TerminalCaptureRecord, 'kind' | 'state' | 'source'> {
  kind: string;
  state: string;
  source: string;
}

const NOT_LIVE = [{ refundFlaggedAt: null }, { refundClearedAt: { not: null } }] as const;

/** Not owed back: never flagged, cleared, or flagged for the timeout a bind clears. */
const NOT_OWED_BACK = [...NOT_LIVE, { refundReason: 'UNBOUND_TIMEOUT' }] as const;

type CaptureFindManyWhere =
  | { clientId: string; transactionCode: { in: string[] } }
  | { clientId: string; orderId: { in: string[] }; state: 'ORDER_CREATED' }
  | { clientId: string; deviceId: { in: string[] }; state: 'UNBOUND'; OR: typeof NOT_OWED_BACK };

type CaptureUpdateWhere =
  | CaptureVersion
  | { id: string; source: 'JOURNAL'; transactionId: null; authorizationCode: null; terminalSerial: null }
  | { clientId: string; transactionCode: string; state?: 'UNBOUND'; OR: typeof NOT_LIVE }
  | { clientId: string; orderId: string; OR: typeof NOT_LIVE };

export interface TerminalCaptureDelegate {
  createMany(args: { data: NewTerminalCapture[]; skipDuplicates: true }): PromiseLike<{ count: number }>;
  findUnique(args: {
    where: { clientId_transactionCode: { clientId: string; transactionCode: string } };
    select: typeof CAPTURE_SELECT;
  }): PromiseLike<CaptureRow | null>;
  findMany(args: {
    where: CaptureFindManyWhere;
    orderBy?: { capturedAt: 'asc' } | readonly [{ capturedAt: 'asc' }, { id: 'asc' }];
    select: typeof CAPTURE_SELECT;
  }): PromiseLike<CaptureRow[]>;
  updateMany(args: { where: CaptureUpdateWhere; data: CapturePatch }): PromiseLike<{ count: number }>;
}

/** What the store needs of a Prisma client or transaction client. */
export interface PrismaTerminalCaptureClient {
  terminalCapture: TerminalCaptureDelegate;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

/** The columns are TEXT held to these sets by the table's CHECKs, so the narrowing is the schema's, not a guess. */
function toRecord(row: CaptureRow): TerminalCaptureRecord {
  return { ...row, kind: row.kind as CaptureKind, state: row.state as CaptureState, source: row.source as CaptureSource };
}

/**
 * One `UPDATE … WHERE id IN (SELECT … LIMIT)`, so a capture bound between the
 * read and the write is not flagged: the outer predicate re-checks the state.
 * The state is a LITERAL so the planner can use the partial index on the
 * UNBOUND rows. Both clocks: `captured_at` is the terminal's, and a terminal
 * whose clock reset to the past would otherwise look a day old the minute it
 * took a capture; `created_at` is the database's own.
 */
async function flagStaleUnbound(prisma: PrismaTerminalCaptureClient, now: Date, cutoff: Date, limit: number): Promise<number> {
  const flagged = await prisma.$executeRaw`
    UPDATE "terminal_captures"
       SET "refund_flagged_at" = ${now}, "refund_reason" = 'UNBOUND_TIMEOUT', "updated_at" = ${now}
     WHERE "id" IN (
             SELECT "id" FROM "terminal_captures"
              WHERE "state" = 'UNBOUND' AND "refund_flagged_at" IS NULL AND "captured_at" <= ${cutoff}
                AND "created_at" <= ${cutoff}
              ORDER BY "captured_at" ASC, "id" ASC
              LIMIT ${limit})
       AND "state" = 'UNBOUND' AND "refund_flagged_at" IS NULL`;
  return flagged;
}

type ClientSource = PrismaTerminalCaptureClient | (() => PrismaTerminalCaptureClient | Promise<PrismaTerminalCaptureClient>);

/** The store over one client. A function is resolved on every call, for a host whose client is built lazily. */
export function createPrismaTerminalCaptureStore(source: ClientSource): TerminalCaptureStore {
  const client = async (): Promise<PrismaTerminalCaptureClient> => (typeof source === 'function' ? source() : source);
  const find = async (clientId: string, transactionCode: string): Promise<TerminalCaptureRecord | null> => {
    const row = await (await client()).terminalCapture.findUnique({
      where: { clientId_transactionCode: { clientId, transactionCode } },
      select: CAPTURE_SELECT,
    });
    return row ? toRecord(row) : null;
  };

  return {
    async insertIfAbsent(row) {
      const inserted = await (await client()).terminalCapture.createMany({ data: [row], skipDuplicates: true });
      return inserted.count === 1;
    },
    find,
    async findMany(clientId, transactionCodes) {
      const rows = await (await client()).terminalCapture.findMany({
        where: { clientId, transactionCode: { in: [...transactionCodes] } },
        select: CAPTURE_SELECT,
      });
      return rows.map(toRecord);
    },
    async completeJournalTrace(id, patch) {
      await (await client()).terminalCapture.updateMany({
        where: { id, source: 'JOURNAL', transactionId: null, authorizationCode: null, terminalSerial: null },
        data: patch,
      });
    },
    async writeIfUnchanged(seen, patch) {
      const { id, state, orderId, refundFlaggedAt, refundClearedAt } = seen;
      const written = await (await client()).terminalCapture.updateMany({
        where: { id, state, orderId, refundFlaggedAt, refundClearedAt },
        data: patch,
      });
      return written.count === 1;
    },
    async flagIfNotLive(clientId, transactionCode, flag, unboundOnly) {
      const written = await (await client()).terminalCapture.updateMany({
        where: { clientId, transactionCode, ...(unboundOnly ? { state: 'UNBOUND' as const } : {}), OR: NOT_LIVE },
        data: { refundFlaggedAt: flag.at, refundReason: flag.reason, refundClearedAt: null },
      });
      return written.count === 1;
    },
    async flagHeldBy(clientId, orderId, flag) {
      const flagged = await (await client()).terminalCapture.updateMany({
        where: { clientId, orderId, OR: NOT_LIVE },
        data: { refundFlaggedAt: flag.at, refundReason: flag.reason, refundClearedAt: null },
      });
      return flagged.count;
    },
    flagStaleUnbound: async (now, cutoff, limit) => flagStaleUnbound(await client(), now, cutoff, limit),
    async findUnclaimed(clientId, deviceIds) {
      const rows = await (await client()).terminalCapture.findMany({
        where: { clientId, deviceId: { in: [...deviceIds] }, state: 'UNBOUND', OR: NOT_OWED_BACK },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        select: CAPTURE_SELECT,
      });
      return rows.map(toRecord);
    },
    async findCreatedFor(clientId, orderIds) {
      const rows = await (await client()).terminalCapture.findMany({
        where: { clientId, orderId: { in: [...orderIds] }, state: 'ORDER_CREATED' },
        orderBy: { capturedAt: 'asc' },
        select: CAPTURE_SELECT,
      });
      return rows.map(toRecord);
    },
  };
}

/**
 * The {@link TerminalCaptureStoreFor} a ledger takes: the store on the host's
 * transaction client when one is passed, on `root` otherwise.
 */
export function prismaTerminalCaptureStoreFor<TTx extends PrismaTerminalCaptureClient>(root: ClientSource): TerminalCaptureStoreFor<TTx> {
  const rootStore = createPrismaTerminalCaptureStore(root);
  return (tx) => (tx ? createPrismaTerminalCaptureStore(tx) : rootStore);
}
