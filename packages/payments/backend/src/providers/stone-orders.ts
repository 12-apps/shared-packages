import type {
  ChargeSnapshot,
  ChargeStatus,
  DeclineReason,
  PaymentMethodKind,
} from '../core/types';
import { capturedAmountCents } from './shared';
import { NAME } from './stone-http';

/**
 * Pagar.me v5 order → normalized snapshot mapping for the Stone adapter: how a
 * provider RESPONSE is read. Kept apart from `stone.ts` so that file stays
 * wiring and this one stays translation, and apart from `stone-payload.ts`,
 * which builds the REQUEST — the direction is the seam.
 */

/** The slice of a Pagar.me charge this adapter reads. */
export interface StoneCharge {
  id?: string;
  status?: string;
  /** The charge as RAISED. */
  amount?: number;
  /** What actually arrived — differs from `amount` on a short or over payment. */
  paid_amount?: number;
  /** The portion that went BACK; the only field a partial refund is measured by. */
  canceled_amount?: number;
  currency?: string;
  payment_method?: string;
  last_transaction?: {
    // PIX
    qr_code?: string;
    qr_code_url?: string;
    expires_at?: string;
    // Boleto
    line?: string;
    barcode?: string;
    pdf?: string;
    url?: string;
    due_at?: string;
    // Card
    card?: { brand?: string; last_four_digits?: string };
    acquirer_return_code?: string;
    acquirer_message?: string;
    gateway_response?: { code?: string };
  };
}

export interface StoneOrder {
  id?: string;
  code?: string;
  status?: string;
  charges?: StoneCharge[];
}

/**
 * Pagar.me charge status → normalized status.
 *
 * `failed` and `not_authorized` are DECLINES, not transport errors: the call
 * worked, the payment did not.
 */
const STATUS: Record<string, ChargeStatus> = {
  paid: 'PAID',
  pending: 'PENDING',
  processing: 'PENDING',
  waiting_payment: 'PENDING',
  authorized_pending_capture: 'AUTHORIZED',
  generated: 'PENDING',
  canceled: 'CANCELED',
  voided: 'CANCELED',
  refunded: 'REFUNDED',
  partial_refunded: 'PARTIALLY_REFUNDED',
  failed: 'DECLINED',
  not_authorized: 'DECLINED',
  with_error: 'DECLINED',
  overpaid: 'PAID',
  /**
   * A shortfall is a SETTLEMENT, not a pending charge: money arrived, just not
   * enough of it. With no entry here it fell through `statusOf`'s `'PENDING'`
   * default and the order parked in silence — the reactor only reaches
   * `settlePayable` for a PAID snapshot, so nothing downstream ever saw the
   * payment, its amount, or that there was anything to reconcile (FUT-674).
   *
   * PAID for the same reason `overpaid` is: this vocabulary has no member for
   * "paid the wrong amount", and the AMOUNT on the snapshot is what a host
   * reconciles against. Reporting it is what routes a shortfall into the
   * host's own guard — settle iff the capture covers the payable, park the
   * rest — instead of nowhere at all. Which is why {@link capturedOf} has to
   * report `paid_amount` here: the amount RAISED would clear that guard and
   * settle an underpaid order in full.
   */
  underpaid: 'PAID',
  // A partial reversal, whose event Pagar.me DOES send (`charge.partial_canceled`).
  // Without it a polled partially-reversed charge fell through to `'PENDING'`
  // and the row never left the pending sweep until its abandon window.
  partial_canceled: 'PARTIALLY_REFUNDED',
};

/** A stated, non-zero number of cents — or null, which is not one. */
export function positiveCents(cents: number | undefined): number | null {
  return typeof cents === 'number' && cents > 0 ? cents : null;
}

/**
 * The statuses that mean money ARRIVED, whatever became of it afterwards. A
 * reversed charge captured first, so it still reports what it captured.
 *
 * This answers "did this charge capture?", and ONLY that — it decides which
 * amount {@link orderSnapshot} reports. "Which charge speaks for the order?"
 * looks like the same question and is not; see {@link SPEAKS_FOR_ORDER}.
 */
const CAPTURED_STATUSES = new Set<ChargeStatus>(['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']);

/**
 * Which charge speaks for its order, strongest voice first.
 *
 * A PRIORITY, not a membership test. Using {@link CAPTURED_STATUSES} for this
 * resolved ties by array order and was wrong in both directions: a reversed
 * charge listed before a live paid one made an `order.paid` report REFUNDED,
 * parking the payable where it used to settle; and an `underpaid` sibling
 * naming no `paid_amount` made the WHOLE delivery throw, so an order that
 * really was paid never settled at all. Both are worse than the `'paid'`-only
 * test they replaced — the trap in widening a predicate that was doing two
 * jobs at once.
 *
 * The first rung reads the RAW status on purpose. `paid`, `underpaid` and
 * `overpaid` all normalize to PAID, so a rank over the NORMALIZED status
 * cannot separate a clean capture from one whose amount is in doubt — which is
 * exactly the tie that threw.
 */
const SPEAKS_FOR_ORDER: ReadonlyArray<(charge: StoneCharge) => boolean> = [
  (charge) => charge.status === 'paid',
  (charge) => statusOf(charge) === 'PAID',
  (charge) => statusOf(charge) === 'PARTIALLY_REFUNDED',
  (charge) => statusOf(charge) === 'REFUNDED',
];

function statusOf(charge: StoneCharge | undefined): ChargeStatus {
  const mapped = STATUS[charge?.status ?? ''] ?? 'PENDING';
  if (mapped !== 'CANCELED') return mapped;
  // A Pagar.me reversal reads `canceled` with the money in `canceled_amount`,
  // and CANCELED does not outrank PAID (`core/status.ts` — equal rank, and an
  // equal-rank change is ignored as a contradiction). So a fully refunded
  // charge polled back left the row sitting at PAID for ever.
  //
  // BOTH numbers are required, and that is the whole care here.
  // `canceled_amount` names the amount CANCELLED, not the amount RETURNED:
  // voiding an unpaid or merely authorized charge cancels its full value with
  // nothing having arrived. Calling that a refund parks a payable for money
  // the buyer never sent, keeps a voided charge in `LIVE_STATUSES` so a
  // failover walk stops on it, and counts a void as PROVEN evidence that a
  // connection can charge. PagBank's adapter tests a field literally named
  // `refunded` (`pagbank-snapshots.ts`), which is why the same rule there needs
  // one number and this one needs two — the technique does not survive the
  // name change on its own.
  //
  // The residual, stated rather than hidden: a reversal that names no
  // `paid_amount` reads CANCELED here, which does not outrank PAID, so the row
  // stays settled. The REFUND event still reports it (`returnedCents` needs only
  // the one number, because the event type has already said a reversal
  // happened), so the ledger learns of it — but the POLL cannot rescue a missed
  // one, and the pending sweep never parks. A void misread as a refund is the
  // worse trade, and no real Pagar.me charge omits `paid_amount`.
  const returned = positiveCents(charge?.canceled_amount);
  const captured = positiveCents(charge?.paid_amount);
  return returned !== null && captured !== null ? 'REFUNDED' : 'CANCELED';
}

/**
 * Map the acquirer's return code onto the normalized decline taxonomy. Codes
 * are the ISO-8583-ish set Pagar.me forwards from the acquirer.
 */
const DECLINE_CODES: Record<string, DeclineReason> = {
  '51': 'INSUFFICIENT_FUNDS',
  '54': 'EXPIRED_CARD',
  '14': 'INVALID_CARD',
  '15': 'INVALID_CARD',
  '43': 'FRAUD_SUSPECTED',
  '41': 'FRAUD_SUSPECTED',
  '62': 'FRAUD_SUSPECTED',
  '05': 'CARD_DECLINED',
  '57': 'CARD_DECLINED',
};

function declineReasonOf(charge: StoneCharge | undefined): DeclineReason {
  const code = charge?.last_transaction?.acquirer_return_code ?? '';
  return DECLINE_CODES[code] ?? 'CARD_DECLINED';
}

const METHODS: Record<string, PaymentMethodKind> = {
  pix: 'PIX',
  credit_card: 'CARD',
  debit_card: 'CARD',
  boleto: 'BOLETO',
};

export function methodOf(charge: StoneCharge | undefined, fallback: PaymentMethodKind): PaymentMethodKind {
  return METHODS[charge?.payment_method ?? ''] ?? fallback;
}

/**
 * The charge that speaks for an order: one that took money if present, else the
 * first. The poll and the webhook read the SAME order object, so they must
 * agree.
 *
 * Asked through {@link SPEAKS_FOR_ORDER} rather than against a flat list of
 * raw statuses. `'paid'` alone was the test,
 * which stopped being true the moment `underpaid` and `overpaid` became
 * settlements — on `[failed, overpaid]` the failed charge spoke for the order
 * and an `order.paid` reported DECLINED — and a hand-kept replacement would
 * have had the same hole one status along, for a reversed sibling. Orders this
 * adapter raises carry exactly one charge
 * (`orderPayload` sends `closed: true` with one payment), so this was mitigated
 * rather than safe, and mitigated by a fact about the REQUEST, which says
 * nothing about a delivery for an order raised anywhere else.
 */
export function settledCharge(order: StoneOrder): StoneCharge | undefined {
  const charges = Array.isArray(order.charges) ? order.charges : [];
  for (const speaks of SPEAKS_FOR_ORDER) {
    const spoken = charges.find(speaks);
    if (spoken) return spoken;
  }
  return charges[0];
}

/** Method-specific artifacts the buyer acts on (QR payload, boleto line). */
function instrumentFields(charge: StoneCharge | undefined, method: PaymentMethodKind): Partial<ChargeSnapshot> {
  const tx = charge?.last_transaction;
  if (!tx) return {};
  if (method === 'PIX' && tx.qr_code) {
    return { pix: { qrText: tx.qr_code, qrImageUrl: tx.qr_code_url, expiresAt: tx.expires_at } };
  }
  if (method === 'BOLETO') {
    return { boleto: { barcode: tx.line ?? tx.barcode, documentUrl: tx.pdf ?? tx.url, dueDate: tx.due_at } };
  }
  if (method === 'CARD' && tx.card) {
    return { card: { brand: tx.card.brand, last4: tx.card.last_four_digits } };
  }
  return {};
}

/**
 * The statuses where `amount` is known NOT to be what was captured, so falling
 * back to it reports a number that is certainly wrong.
 *
 * `underpaid` alone, and the asymmetry with `overpaid` is deliberate. Reporting
 * the RAISED amount for a shortfall settles an order for money that never
 * arrived — strictly worse than the silence this whole change replaces — so a
 * delivery that does not say how much came in must refuse, leaving the row
 * retryable and the order honestly unpaid. For an overpayment the same fallback
 * only UNDER-reports: at least the payable did arrive, so it settles correctly
 * and merely the excess goes unnoticed, and refusing there would strand a buyer
 * who paid in full.
 *
 * "Refuse" is what {@link capturedAmountCents} does with the `undefined` this
 * produces, so it holds for every caller READING provider state. The one caller
 * that supplies a fallback — `createChargeWith`, which knows what it asked to
 * be charged — reports that instead, and is unreachable here anyway: a
 * synchronous `POST /orders` cannot come back short.
 *
 * On the WEBHOOK path the refusal happens in `parse`, which `runWebhookPipeline`
 * calls before `webhooks.record` — so it leaves no inbox row, nothing for the
 * replay sweep to re-drive, and only the provider's own redelivery to retry it.
 * That redelivery carries the same payload and fails the same way, so the
 * honest reading is "loudly rejected", not "will be picked up later".
 */
const SHORTFALL_STATUSES = new Set(['underpaid']);

/**
 * What the buyer actually PAID, which is not always what was asked for.
 *
 * Pagar.me reports both: `amount` is the charge as RAISED, `paid_amount` what
 * ARRIVED. They agree on an ordinary `paid` and diverge only on the two events
 * this adapter would otherwise misreport — `underpaid`, where less came in,
 * and `overpaid`, where more did. Reporting `amount` for those hands the host
 * the number it asked for rather than the number it got: a shortfall clears
 * the host's coverage guard and settles in full, and an overpayment never
 * reaches the surface that exists to flag one.
 *
 * Read only for a SETTLED charge, and only when POSITIVE. `paid_amount: 0` is
 * what an untouched charge carries, and {@link capturedAmountCents} accepts any
 * number it is handed — so a zero would be reported as a real capture of
 * nothing: the reactor settles on it while `snapshot-merge` substitutes the
 * stored amount back into the row, two different numbers from one delivery and
 * neither of them loud. An unpaid charge falls through for the same reason, and
 * a pending snapshot is expected to echo the amount raised anyway.
 */
function capturedOf(charge: StoneCharge | undefined, captured: boolean): number | undefined {
  const paid = charge?.paid_amount;
  if (captured && typeof paid === 'number' && paid > 0) return paid;
  if (SHORTFALL_STATUSES.has(charge?.status ?? '')) return undefined;
  return charge?.amount;
}

/**
 * `fallback.amountCents` is OPTIONAL by design: only a caller that already
 * knows what it asked to be charged (`createCharge`) may supply one. A caller
 * merely READING provider state passes nothing, so a `paid` charge that
 * arrives without an amount is refused rather than reported as 0 cents — see
 * {@link capturedAmountCents}.
 */
export function orderSnapshot(
  order: StoneOrder,
  fallback: { amountCents?: number; currency: string; method: PaymentMethodKind; id?: string },
): ChargeSnapshot {
  const charge = settledCharge(order);
  const status = statusOf(charge);
  const method = methodOf(charge, fallback.method);
  return {
    provider: NAME,
    providerChargeId: charge?.id ?? order.id ?? fallback.id ?? '',
    // `code` is the reference `orderPayload` sends, echoed back verbatim.
    ...(order.code ? { reference: order.code } : {}),
    status,
    amount: {
      amountCents: capturedAmountCents(
        NAME,
        status === 'PAID',
        // CAPTURED, not settled: a REFUNDED charge took money before it gave
        // it back, and reporting the amount raised for one that settled short
        // writes a capture larger than reality over the row the host parked.
        // The refusal beside it stays scoped to PAID — see `capturedAmountCents`.
        capturedOf(charge, CAPTURED_STATUSES.has(status)),
        fallback.amountCents,
      ),
      currency: (charge?.currency ?? fallback.currency).toUpperCase(),
    },
    method,
    ...instrumentFields(charge, method),
    ...(status === 'DECLINED' ? { declineReason: declineReasonOf(charge) } : {}),
    raw: order,
  };
}
