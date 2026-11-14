/**
 * The terminal capture record's vocabulary: one row per card or Pix capture a
 * paired payment terminal took, written before or apart from any sale, with a
 * state of its own.
 *
 *   UNBOUND ── markSaleCreated ──▶ ORDER_CREATED ── bind ──▶ BOUND
 *      └───────────────────────── bind ─────────────────────────▲
 *
 * The literals are the stored values: a host's table holds the same sets in
 * its CHECK constraints, so they are never renamed here.
 *
 * Server-safe and dependency-free.
 */

export const CAPTURE_KINDS = ['CREDIT', 'DEBIT', 'PIX'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

/**
 * Who reported the capture: the terminal itself (`DEVICE`), or the station
 * relaying what the terminal told it over the signed link (`STATION`). Both
 * are the terminal's word: nothing else may record a capture, so a sale is
 * never paid by a capture the terminal did not report.
 */
export type CaptureSource = 'DEVICE' | 'STATION';

/**
 * The source a stored row may carry. `JOURNAL` is a legacy value a host may
 * still hold from before this package (a capture kept from a cashier-typed
 * code); the package reads it but never writes it.
 */
export type StoredCaptureSource = CaptureSource | 'JOURNAL';

export type CaptureState = 'UNBOUND' | 'ORDER_CREATED' | 'BOUND';

/**
 * The refund reasons this package itself writes or reads. A host may write
 * others of its own (a trigger, a reduced bill), which is why a record's
 * `refundReason` is an open string: the package never narrows what it did not
 * write.
 *
 * - `UNBOUND_TIMEOUT`: no sale claimed the capture within the window (the sweep).
 * - `SALE_NOT_CREATED`: the sale the capture was taken for was never written.
 * - `SALE_CANCELLED`: the sale holding the capture was cancelled.
 * - `PAYMENT_UNDONE`: the payment holding the capture was undone.
 * - `RECEIVED_TWICE`: the terminal approved a leg the sale had already received
 *   another way (in cash), and the operator chose to give the card capture
 *   back (FUT-4996, Decision 3). Only a capture no sale holds: money a sale
 *   holds is the sale's, never owed back too.
 */
export const PACKAGE_REFUND_REASONS = [
  'UNBOUND_TIMEOUT',
  'SALE_NOT_CREATED',
  'SALE_CANCELLED',
  'PAYMENT_UNDONE',
  'RECEIVED_TWICE',
] as const;
export type PackageRefundReason = (typeof PACKAGE_REFUND_REASONS)[number];

/** The reasons that say no sale holds the capture; a capture a sale holds is never flagged for them. */
export const UNBOUND_ONLY_REASONS: ReadonlySet<string> = new Set<PackageRefundReason>([
  'UNBOUND_TIMEOUT',
  'SALE_NOT_CREATED',
  'RECEIVED_TWICE',
]);

/** What the terminal reported beside the code and the amount. Every field may be missing. */
export interface CaptureTrace {
  transactionId?: string | null;
  hostNsu?: string | null;
  authorizationCode?: string | null;
  cardBrand?: string | null;
  installments?: number | null;
  terminalSerial?: string | null;
  entryMode?: string | null;
}

export interface RecordCaptureInput extends CaptureTrace {
  clientId: string;
  transactionCode: string;
  kind: CaptureKind;
  amountCents: number;
  source: CaptureSource;
  /** The terminal that took it, when known. Must be this tenant's. */
  deviceId?: string | null;
  capturedAt: Date;
}

/** The row as a store answers it. */
export interface TerminalCaptureRecord extends Required<CaptureTrace> {
  id: string;
  clientId: string;
  transactionCode: string;
  kind: CaptureKind;
  amountCents: number;
  state: CaptureState;
  source: StoredCaptureSource;
  deviceId: string | null;
  /** The sale (the host's order row) that holds the capture, once one does. */
  orderId: string | null;
  /** The sale's payment row the capture is a leg of, once BOUND. */
  paymentId: string | null;
  capturedAt: Date;
  refundFlaggedAt: Date | null;
  /** A {@link PackageRefundReason}, or a reason the host wrote itself. */
  refundReason: string | null;
  refundClearedAt: Date | null;
}

/** The sale and payment row a capture becomes a leg of. */
export interface BindTarget {
  orderId: string;
  paymentId: string;
}

/** A capture's key: a transaction code is unique per tenant only. */
export interface CaptureKey {
  clientId: string;
  transactionCode: string;
}

/**
 * A move the capture's record refuses.
 *
 * - `CONFLICT`: the same code arrived with another amount or kind.
 * - `NOT_FOUND`: no capture with that code at this tenant.
 * - `BOUND_ELSEWHERE`: the capture already belongs to another sale or payment row.
 * - `SALE_MISMATCH`: the sale or payment row named is not this tenant's, or the
 *   payment row is not the sale's.
 * - `DEVICE_MISMATCH`: the terminal named is not this tenant's.
 * - `FLAGGED`: the capture was flagged for a refund for a reason a bind cannot undo.
 * - `NOT_UNBOUND`: the refund reason (`SALE_NOT_CREATED`, `UNBOUND_TIMEOUT`,
 *   `RECEIVED_TWICE`, or one the host named unbound-only) only fits a capture
 *   no sale holds, and this one is held by a sale.
 * - `CONTENDED`: the row kept changing under the move; nothing was written.
 */
export type CaptureErrorCode =
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'BOUND_ELSEWHERE'
  | 'SALE_MISMATCH'
  | 'DEVICE_MISMATCH'
  | 'FLAGGED'
  | 'NOT_UNBOUND'
  | 'CONTENDED';

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  readonly transactionCode: string;

  constructor(code: CaptureErrorCode, transactionCode: string, message: string) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    this.transactionCode = transactionCode;
  }
}

/**
 * Why a capture could not be taken by a sale, as a sale-path answers it: the
 * same outcomes whether a look-up found it before anything was written or a
 * move refused it mid-request.
 *
 * `CONTENDED` is the one transient answer: the row kept changing under the
 * move (another request was moving the same capture), nothing was written, and
 * the same request may be sent again. It is never `BOUND_ELSEWHERE`, which
 * would say another sale holds money that is only busy (FUT-4996, R43).
 */
export type CaptureNotBoundReason = 'BOUND_ELSEWHERE' | 'FLAGGED' | 'CONFLICT' | 'DEVICE_UNKNOWN' | 'CONTENDED';

/** A move's refusal as the reason a sale-path names it. */
export function notBoundReasonOf(error: CaptureError): CaptureNotBoundReason {
  if (error.code === 'CONFLICT') return 'CONFLICT';
  if (error.code === 'DEVICE_MISMATCH') return 'DEVICE_UNKNOWN';
  if (error.code === 'FLAGGED') return 'FLAGGED';
  if (error.code === 'CONTENDED') return 'CONTENDED';
  return 'BOUND_ELSEWHERE';
}

/** The trace as columns: a field the terminal omitted is stored as NULL. */
export function traceColumns(trace: CaptureTrace): Required<CaptureTrace> {
  return {
    transactionId: trace.transactionId ?? null,
    hostNsu: trace.hostNsu ?? null,
    authorizationCode: trace.authorizationCode ?? null,
    cardBrand: trace.cardBrand ?? null,
    installments: trace.installments ?? null,
    terminalSerial: trace.terminalSerial ?? null,
    entryMode: trace.entryMode ?? null,
  };
}

/** Flagged and not cleared: the money is owed back unless a bind clears it. */
export function refundLive(record: Pick<TerminalCaptureRecord, 'refundFlaggedAt' | 'refundClearedAt'>): boolean {
  return record.refundFlaggedAt !== null && record.refundClearedAt === null;
}

/** A capture time a terminal's clock put in the future is read as now. */
export function clampToNow(at: Date, now: Date): Date {
  return at.getTime() > now.getTime() ? now : at;
}
