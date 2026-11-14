import type { CaptureKind, CaptureSource, CaptureState, CaptureTrace, TerminalCaptureRecord } from './model';

/**
 * The terminal capture ledger's ports. The engine decides; the host answers
 * these over its own tables, and every one of them runs on the HOST's
 * transaction handle when one is passed — `TTx` is whatever that handle is, and
 * the package never looks inside it.
 */

/** A capture as it is first written: UNBOUND, held by nothing, never flagged. */
export interface NewTerminalCapture extends Required<CaptureTrace> {
  clientId: string;
  transactionCode: string;
  kind: CaptureKind;
  amountCents: number;
  source: CaptureSource;
  deviceId: string | null;
  capturedAt: Date;
}

/**
 * The version of a row a move decided on. A write predicated on it lands only
 * on that row as it was read: a flag (or a clear) committed after the read
 * makes it match nothing, and the move decides again.
 */
export interface CaptureVersion {
  id: string;
  state: CaptureState;
  orderId: string | null;
  refundFlaggedAt: Date | null;
  refundClearedAt: Date | null;
}

/** The columns a move may write. Absent: left as it is. */
export interface CapturePatch extends CaptureTrace {
  kind?: CaptureKind;
  amountCents?: number;
  state?: CaptureState;
  deviceId?: string;
  orderId?: string;
  paymentId?: string;
  refundFlaggedAt?: Date;
  refundReason?: string;
  refundClearedAt?: Date | null;
}

/** A refund flag as it is written: the time and why. */
export interface RefundFlag {
  at: Date;
  reason: string;
}

/**
 * The capture table, bound to one handle (the host's transaction, or none).
 *
 * Each method is ONE statement in a database-backed store; the engine's
 * guarantees rest on these predicates holding inside that statement.
 */
export interface TerminalCaptureStore {
  /** Insert unless `(clientId, transactionCode)` exists — never a caught unique violation. True when inserted. */
  insertIfAbsent(row: NewTerminalCapture): Promise<boolean>;
  find(clientId: string, transactionCode: string): Promise<TerminalCaptureRecord | null>;
  /** The tenant's captures under these codes, in no particular order. */
  findMany(clientId: string, transactionCodes: readonly string[]): Promise<TerminalCaptureRecord[]>;
  /** Write `patch` only on the row exactly as `seen`. True when it landed. */
  writeIfUnchanged(seen: CaptureVersion, patch: CapturePatch): Promise<boolean>;
  /**
   * Flag the capture unless a flag is live (flagged and not cleared), and,
   * when `unboundOnly`, only while it is UNBOUND. The clear is reset. True when written.
   */
  flagIfNotLive(clientId: string, transactionCode: string, flag: RefundFlag, unboundOnly: boolean): Promise<boolean>;
  /** Flag every capture the sale holds whose flag is not live. How many were flagged. */
  flagHeldBy(clientId: string, orderId: string, flag: RefundFlag): Promise<number>;
  /**
   * Flag `UNBOUND_TIMEOUT`, oldest first and at most `limit`, the UNBOUND,
   * never-flagged captures taken AND recorded at or before `cutoff` — both
   * clocks: the terminal's and the store's own. Across tenants. How many.
   */
  flagStaleUnbound(now: Date, cutoff: Date, limit: number): Promise<number>;
  /** The ORDER_CREATED captures of these sales, oldest capture first. */
  findCreatedFor(clientId: string, orderIds: readonly string[]): Promise<TerminalCaptureRecord[]>;
}

/** The store on the host's transaction, or on its root handle when none is passed. */
export type TerminalCaptureStoreFor<TTx = unknown> = (tx?: TTx) => TerminalCaptureStore;

/** Which payment terminals are the tenant's. */
export interface TerminalDirectory<TTx = unknown> {
  /** Every one of `deviceIds` (never empty) is a terminal of this tenant. */
  devicesBelong(clientId: string, deviceIds: readonly string[], tx?: TTx): Promise<boolean>;
}

/** Which sales and payment rows are the tenant's. */
export interface SaleDirectory<TTx = unknown> {
  /** The sale is this tenant's. */
  saleBelongs(tx: TTx, clientId: string, orderId: string): Promise<boolean>;
  /** The payment row is the sale's own, and the sale is this tenant's. */
  paymentBelongs(tx: TTx, clientId: string, orderId: string, paymentId: string): Promise<boolean>;
}

/**
 * A nested rollback point inside the host's transaction (SQL `SAVEPOINT`), so
 * one capture that cannot bind undoes only its own writes and the rest go on.
 */
export interface Savepoint<TTx = unknown> {
  open(tx: TTx): Promise<void>;
  release(tx: TTx): Promise<void>;
  rollBack(tx: TTx): Promise<void>;
}

/** What the SQL savepoint needs of a handle. */
export interface RawSqlHandle {
  $executeRawUnsafe(query: string): PromiseLike<unknown>;
}

/** The {@link Savepoint} as three SQL statements on a handle that runs raw SQL. */
export function sqlSavepoint<TTx extends RawSqlHandle>(name = 'terminal_capture'): Savepoint<TTx> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Not a savepoint name: ${name}`);
  return {
    open: async (tx) => void (await tx.$executeRawUnsafe(`SAVEPOINT ${name}`)),
    release: async (tx) => void (await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`)),
    rollBack: async (tx) => void (await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`)),
  };
}
