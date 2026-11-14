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
 * Who reported the capture: the terminal itself (`DEVICE`), the station that
 * drove it (`STATION`), or the station's offline journal from the leg alone,
 * having lost the trace (`JOURNAL`).
 */
export type CaptureSource = 'DEVICE' | 'STATION' | 'JOURNAL';

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
 * - `JOURNAL_CONFLICT`: the terminal reported another kind or amount than the
 *   offline leg the journal recorded the capture from; a person reviews the sale.
 */
export const PACKAGE_REFUND_REASONS = [
  'UNBOUND_TIMEOUT',
  'SALE_NOT_CREATED',
  'SALE_CANCELLED',
  'PAYMENT_UNDONE',
  'JOURNAL_CONFLICT',
] as const;
export type PackageRefundReason = (typeof PACKAGE_REFUND_REASONS)[number];

/** The reasons that say no sale holds the capture; a capture a sale holds is never flagged for them. */
export const UNBOUND_ONLY_REASONS: ReadonlySet<string> = new Set<PackageRefundReason>([
  'UNBOUND_TIMEOUT',
  'SALE_NOT_CREATED',
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
  source: CaptureSource;
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
 * - `NOT_UNBOUND`: the refund reason (`SALE_NOT_CREATED`, `UNBOUND_TIMEOUT`)
 *   only fits a capture no sale holds, and this one is held by a sale.
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
 * same four outcomes whether a look-up found it before anything was written
 * or a move refused it mid-request.
 */
export type CaptureNotBoundReason = 'BOUND_ELSEWHERE' | 'FLAGGED' | 'CONFLICT' | 'DEVICE_UNKNOWN';

/** A move's refusal as the reason a sale-path names it. */
export function notBoundReasonOf(error: CaptureError): CaptureNotBoundReason {
  if (error.code === 'CONFLICT') return 'CONFLICT';
  if (error.code === 'DEVICE_MISMATCH') return 'DEVICE_UNKNOWN';
  if (error.code === 'FLAGGED') return 'FLAGGED';
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
