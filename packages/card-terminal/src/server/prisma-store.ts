import type { CaptureKind, CaptureState, StoredCaptureSource, TerminalCaptureRecord } from './model';
import type { CapturePatch, CaptureVersion, NewTerminalCapture, StaleHeldCursor, TerminalCaptureStore, TerminalCaptureStoreFor } from './ports';

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
 * `(client_id, transaction_code)`, with partial indexes on the UNBOUND and the
 * ORDER_CREATED rows by `captured_at` for the sweep, and a `created_at` the
 * database writes; the column names are the ones below.
 *
 * Holds (`hold`, `findHeld`) are opt-in: `{ holds: true }` says the host's
 * table maps a nullable `hold_key` column (`holdKey` on the model), and only
 * then does the store select it, write it and answer `findHeld`. Without it
 * the store never names the column, so a table migrated before it still works.
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

/** {@link CAPTURE_SELECT} with the hold, for a table that maps `hold_key` (`{ holds: true }`). */
export const CAPTURE_HOLD_SELECT = { ...CAPTURE_SELECT, holdKey: true } as const;

/** What the store selects: the hold only when the table maps it. */
export type CaptureSelect = typeof CAPTURE_SELECT | typeof CAPTURE_HOLD_SELECT;

export interface PrismaTerminalCaptureStoreOptions {
  /** The table maps a nullable `hold_key` column (`holdKey`): the store keeps holds. Default: false. */
  holds?: boolean;
}

/** The row as Prisma returns it under {@link CAPTURE_SELECT}: the sets are TEXT columns held by CHECKs. */
export interface CaptureRow extends Omit<TerminalCaptureRecord, 'kind' | 'state' | 'source'> {
  kind: string;
  state: string;
  source: string;
}

/** A legacy `JOURNAL` row still awaiting its terminal report (see `CaptureVersion.awaitingReport`). */
const AWAITING_REPORT = { source: 'JOURNAL', transactionId: null, authorizationCode: null, terminalSerial: null } as const;

const NOT_LIVE = [{ refundFlaggedAt: null }, { refundClearedAt: { not: null } }] as const;

/** Not owed back: never flagged, cleared, or flagged for the timeout a bind clears. */
const NOT_OWED_BACK = [...NOT_LIVE, { refundReason: 'UNBOUND_TIMEOUT' }] as const;

type CaptureFindManyWhere =
  | { clientId: string; transactionCode: { in: string[] } }
  | { clientId: string; orderId: { in: string[] }; state: 'ORDER_CREATED' }
  | { clientId: string; deviceId: { in: string[] }; state: 'UNBOUND'; OR: typeof NOT_OWED_BACK }
  | { clientId: string; holdKey: string; state: 'UNBOUND'; OR: typeof NOT_LIVE }
  | {
      state: 'ORDER_CREATED';
      capturedAt: { lte: Date };
      createdAt: { lte: Date };
      AND: readonly [{ OR: typeof NOT_LIVE }, ...{ OR: readonly StaleHeldAfter[] }[]];
    };

/** Strictly after a (`captured_at`, `id`) cursor. */
type StaleHeldAfter = { capturedAt: { gt: StaleHeldCursor['capturedAt'] } } | { capturedAt: Date; id: { gt: string } };

type CaptureUpdateWhere =
  | CaptureVersion
  | { clientId: string; transactionCode: string; state?: 'UNBOUND'; OR: typeof NOT_LIVE }
  | { clientId: string; orderId: string; OR: typeof NOT_LIVE };

export interface TerminalCaptureDelegate {
  createMany(args: { data: NewTerminalCapture[]; skipDuplicates: true }): PromiseLike<{ count: number }>;
  findUnique(args: {
    where: { clientId_transactionCode: { clientId: string; transactionCode: string } };
    select: CaptureSelect;
  }): PromiseLike<CaptureRow | null>;
  findMany(args: {
    where: CaptureFindManyWhere;
    orderBy?: { capturedAt: 'asc' } | readonly [{ capturedAt: 'asc' }, { id: 'asc' }];
    take?: number;
    select: CaptureSelect;
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
  return { ...row, kind: row.kind as CaptureKind, state: row.state as CaptureState, source: row.source as StoredCaptureSource };
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

/** The held captures of one sale context: UNBOUND, flag not live, oldest first. */
async function findHeld(prisma: PrismaTerminalCaptureClient, clientId: string, holdKey: string): Promise<TerminalCaptureRecord[]> {
  const rows = await prisma.terminalCapture.findMany({
    where: { clientId, holdKey, state: 'UNBOUND', OR: NOT_LIVE },
    orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
    select: CAPTURE_HOLD_SELECT,
  });
  return rows.map(toRecord);
}

/**
 * The store over one client. A function is resolved on every call, for a host
 * whose client is built lazily. `{ holds: true }` when the table maps
 * `hold_key` ({@link PrismaTerminalCaptureStoreOptions}).
 */
export function createPrismaTerminalCaptureStore(source: ClientSource, options: PrismaTerminalCaptureStoreOptions = {}): TerminalCaptureStore {
  const client = async (): Promise<PrismaTerminalCaptureClient> => (typeof source === 'function' ? source() : source);
  const select: CaptureSelect = options.holds ? CAPTURE_HOLD_SELECT : CAPTURE_SELECT;
  const find = async (clientId: string, transactionCode: string): Promise<TerminalCaptureRecord | null> => {
    const row = await (await client()).terminalCapture.findUnique({
      where: { clientId_transactionCode: { clientId, transactionCode } },
      select,
    });
    return row ? toRecord(row) : null;
  };
  const holds = options.holds ? { findHeld: async (clientId: string, holdKey: string) => findHeld(await client(), clientId, holdKey) } : {};

  return {
    ...holds,
    async insertIfAbsent(row) {
      const inserted = await (await client()).terminalCapture.createMany({ data: [row], skipDuplicates: true });
      return inserted.count === 1;
    },
    find,
    async findMany(clientId, transactionCodes) {
      const rows = await (await client()).terminalCapture.findMany({
        where: { clientId, transactionCode: { in: [...transactionCodes] } },
        select,
      });
      return rows.map(toRecord);
    },
    async writeIfUnchanged(seen, patch) {
      const { id, state, orderId, refundFlaggedAt, refundClearedAt, awaitingReport, holdKey } = seen;
      const written = await (await client()).terminalCapture.updateMany({
        where: {
          id,
          state,
          orderId,
          refundFlaggedAt,
          refundClearedAt,
          ...(awaitingReport ? AWAITING_REPORT : {}),
          ...(holdKey === undefined ? {} : { holdKey }),
        },
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
    async findStaleHeld(cutoff, limit, after) {
      // Both clocks, as the unbound sweep: the terminal's `captured_at` and the database's `created_at`.
      const past = after ? [{ OR: [{ capturedAt: { gt: after.capturedAt } }, { capturedAt: after.capturedAt, id: { gt: after.id } }] }] : [];
      const rows = await (await client()).terminalCapture.findMany({
        where: { state: 'ORDER_CREATED', capturedAt: { lte: cutoff }, createdAt: { lte: cutoff }, AND: [{ OR: NOT_LIVE }, ...past] },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select,
      });
      return rows.map(toRecord);
    },
    async findUnclaimed(clientId, deviceIds) {
      const rows = await (await client()).terminalCapture.findMany({
        where: { clientId, deviceId: { in: [...deviceIds] }, state: 'UNBOUND', OR: NOT_OWED_BACK },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        select,
      });
      return rows.map(toRecord);
    },
    async findCreatedFor(clientId, orderIds) {
      const rows = await (await client()).terminalCapture.findMany({
        where: { clientId, orderId: { in: [...orderIds] }, state: 'ORDER_CREATED' },
        orderBy: { capturedAt: 'asc' },
        select,
      });
      return rows.map(toRecord);
    },
  };
}

/**
 * The {@link TerminalCaptureStoreFor} a ledger takes: the store on the host's
 * transaction client when one is passed, on `root` otherwise.
 */
export function prismaTerminalCaptureStoreFor<TTx extends PrismaTerminalCaptureClient>(
  root: ClientSource,
  options: PrismaTerminalCaptureStoreOptions = {},
): TerminalCaptureStoreFor<TTx> {
  const rootStore = createPrismaTerminalCaptureStore(root, options);
  return (tx) => (tx ? createPrismaTerminalCaptureStore(tx, options) : rootStore);
}
