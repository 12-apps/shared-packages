import type { LedgerFormatters, ShortPaymentWire } from './wire';

/**
 * The short-payment queue's display projection.
 *
 * Three of these five decisions are the reason this is not a `map` a host
 * writes for itself, and each one has been wrong in production:
 *
 * - **Which amount is "captured".** The audit diff can be missing it, and the
 *   payment row beside it is the same money seen by a second witness. Reading
 *   only the diff printed a dash where real money had landed.
 * - **What the row's SITUATION is.** An operator's decision is shown INSTEAD of
 *   the order status, not beside it: a refunded shortfall leaves the order
 *   FAILED forever, so reading the status alone keeps calling finished work
 *   unreconciled — the same reason a sidebar badge has to subtract decisions.
 * - **Whether the row is still WORK.** `pending` is what the row actions hang
 *   off, and a settled order with no decision recorded is not work either.
 */

/** A wire row shaped for a table. Labels are formatted; `pending` is a fact. */
export interface ShortPaymentRow extends Record<string, unknown> {
  id: string;
  detectedAtLabel: string;
  orderId: string;
  expectedLabel: string;
  capturedLabel: string;
  shortfallLabel: string;
  outcomeLabel: string;
  methodLabel: string;
  chargeLabel: string;
  /** Drives the row actions: a decided shortfall offers none. */
  pending: boolean;
}

/**
 * What the SITUATION column can say, in the host's words.
 *
 * Two tables rather than one, because they answer different questions: what an
 * operator DECIDED, and — when nobody has — what the order's status implies. A
 * status or resolution with no entry falls through as its own raw value, which
 * is the honest answer for a state this package has not met.
 */
export interface ShortPaymentOutcomeCopy {
  /** Keyed by `resolution` — `SETTLED`, `REFUNDED`. */
  readonly resolution: Readonly<Record<string, string>>;
  /** Keyed by `orderStatus`, for a row nobody has decided yet. */
  readonly orderStatus: Readonly<Record<string, string>>;
}

/** The decision if there is one, else what the order's status implies. */
function outcomeLabel(
  entry: ShortPaymentWire,
  copy: ShortPaymentOutcomeCopy,
  placeholder: string,
): string {
  if (entry.resolution) return copy.resolution[entry.resolution] ?? entry.resolution;
  if (!entry.orderStatus) return placeholder;
  return copy.orderStatus[entry.orderStatus] ?? entry.orderStatus;
}

export function toShortPaymentRows(
  entries: ShortPaymentWire[],
  format: LedgerFormatters,
  copy: ShortPaymentOutcomeCopy,
): ShortPaymentRow[] {
  const money = (cents: number | null): string =>
    cents === null ? format.placeholder : format.amount(cents);

  return entries.map((entry) => ({
    id: entry.id,
    detectedAtLabel: format.dateTime(entry.detectedAt),
    orderId: entry.orderId,
    expectedLabel: money(entry.expectedCents),
    // Same money, two witnesses: prefer the audit diff, fall back to the
    // payment row it was joined to. Reading only the diff printed a dash over
    // a capture that had really happened.
    capturedLabel: money(entry.capturedCents ?? entry.payment?.amountCents ?? null),
    shortfallLabel: money(entry.shortfallCents),
    outcomeLabel: outcomeLabel(entry, copy, format.placeholder),
    methodLabel: entry.method ?? format.placeholder,
    chargeLabel: entry.providerChargeId ?? format.placeholder,
    // Still work: nobody decided, and the order did not settle by itself.
    pending: entry.resolution === null && entry.orderStatus !== 'PAID',
  }));
}
