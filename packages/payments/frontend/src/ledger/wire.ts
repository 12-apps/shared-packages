/**
 * The two payment LEDGERS a store operator reads (FUT-764 burn-down).
 *
 * Every charge raised against every order, and the subset where the provider
 * captured LESS than the order was worth. Both are server-driven lists over
 * rows this package's own tables produce, and every host that mounts the
 * payments platform has both — which is why the projection, the query mapping
 * and the one write live here rather than being derived again per adopter.
 *
 * Deliberately UI-FREE. There is no component in this folder and no design
 * system anywhere near it: a ledger is a table, every host already has one, and
 * a grid slot wide enough to satisfy them all would be a worse contract than
 * handing over rows. What a host renders is its own; WHAT IT MEANS is here.
 */

/** One row of the store's payment ledger, as the API answers it. */
export interface PaymentLedgerWire {
  id: string;
  createdAt: string;
  orderId: string | null;
  status: string;
  provider: string | null;
  method: string | null;
  amountCents: number;
  /** What the order was worth, when this charge fell short of it. */
  expectedCents?: number | null;
  /** The gap, present only on a short capture. */
  shortfallCents?: number | null;
  providerChargeId: string | null;
}

/** One row of the short-payment reconciliation queue, as the API answers it. */
export interface ShortPaymentWire {
  id: string;
  detectedAt: string;
  orderId: string;
  orderStatus: string | null;
  capturedCents: number | null;
  expectedCents: number | null;
  shortfallCents: number | null;
  method: string | null;
  providerChargeId: string | null;
  /** The payment row the money actually landed on — the second witness. */
  payment: { id: string; status: string; amountCents: number; createdAt: string } | null;
  /** `SETTLED` / `REFUNDED` once an operator decided; null while waiting. */
  resolution: string | null;
  resolvedAt: string | null;
}

/** How a host writes the two things a ledger row is made of. */
export interface LedgerFormatters {
  /** A cents amount, in the operator's language and this product's currency. */
  amount: (cents: number) => string;
  /** A wire timestamp, as the operator reads dates elsewhere in the console. */
  dateTime: (iso: string) => string;
  /** What stands in for a field the row does not carry. */
  placeholder: string;
}
