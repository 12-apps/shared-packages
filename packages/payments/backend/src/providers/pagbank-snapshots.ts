/**
 * PagBank response bodies → the shared {@link ChargeSnapshot} shape.
 *
 * Split out of `pagbank.ts` (FUT-596), which had reached the 400-line ceiling
 * with the adapter object, the request payloads and this mapping layer all in
 * one file. This is the seam the rest of the package already uses for PagBank
 * — `pagbank-http`, `pagbank-declines`, `pagbank-webhook`, `pagbank-probe` —
 * and the cut is along the same line: everything here reads a body PagBank
 * sent and answers with OUR vocabulary, so nothing above it has to know the
 * vendor's field names.
 *
 * The rules carried over verbatim from the adapter:
 *   - a card DECLINE is a business outcome, never an exception;
 *   - a PAID charge with no amount is refused rather than normalized to zero;
 *   - a missing order/charge/qr field is a `ProviderRequestError`, because a
 *     half-mapped snapshot is worse than a loud failure.
 */
import { ProviderRequestError } from '../core/errors';
import type { ChargeInput, ChargeSnapshot } from '../core/types';

import { pagbankDecline, type PagBankPaymentRawData } from './pagbank-declines';
import { NAME } from './pagbank-http';
import { capturedAmountCents } from './shared';

export interface PagBankPixResponse {
  id?: string;
  charges?: Array<{ id?: string; qr_codes?: Array<{ text?: string }> }>;
  qr_codes?: Array<{ text?: string; expiration_date?: string }>;
}

export interface PagBankCardCharge {
  id?: string;
  status?: string;
  /** The ABECS outcome — `code` is the refusal, `raw_data` says which of its
   *  issuer reasons, the only thing telling an expired card from a typo. */
  payment_response?: { code?: string; message?: string; raw_data?: PagBankPaymentRawData };
  payment_method?: { card?: { id?: string; brand?: string; last_digits?: string } };
}

export interface PagBankCardResponse {
  id?: string;
  charges?: PagBankCardCharge[];
}

/** One charge entry of an order body, as much of it as this mapping reads. */
export interface PagBankOrderCharge {
  id?: unknown;
  status?: unknown;
  amount?: { value?: unknown; summary?: { refunded?: unknown } };
}

export interface PagBankOrderResponse {
  id?: unknown;
  reference_id?: unknown;
  charges?: PagBankOrderCharge[];
  qr_codes?: Array<{ expiration_date?: unknown }>;
}

/**
 * The charge that decides an order's state: a PAID one if present, else the
 * first. Both the poll and the webhook read the SAME order object, so they
 * must agree on which charge speaks for it.
 */
export function settledCharge(res: PagBankOrderResponse) {
  const charges = Array.isArray(res.charges) ? res.charges : [];
  return charges.find((c) => c.status === 'PAID') ?? charges[0];
}

/** The refunded total a canceled charge reports, or 0 when it reports none. */
export function refundedCents(charge: PagBankOrderCharge | undefined): number {
  const refunded = charge?.amount?.summary?.refunded;
  return typeof refunded === 'number' ? refunded : 0;
}

/**
 * Slack after the QR's own deadline before this mapping calls the order
 * EXPIRED. A PIX initiated in the window's final seconds may legitimately
 * SETTLE after it — the deadline gates initiation at the payer's bank, not
 * completion — and `EXPIRED` and `PAID` are contradictory outcomes the status
 * ranks refuse to reorder. Half an hour is far beyond any bank's completion
 * lag, and the buyer-facing screen does not wait for this: the host's own TTL
 * already shows the expired state with a retry path.
 */
const QR_EXPIRY_GRACE_MS = 30 * 60 * 1000;

/** True when the order can no longer be paid: no charge, every QR long dead. */
function qrExpired(res: PagBankOrderResponse, now: number): boolean {
  const qrCodes = Array.isArray(res.qr_codes) ? res.qr_codes : [];
  if (qrCodes.length === 0) return false;
  return qrCodes.every((qr) => {
    const expiresAt = typeof qr.expiration_date === 'string' ? Date.parse(qr.expiration_date) : NaN;
    return Number.isFinite(expiresAt) && now > expiresAt + QR_EXPIRY_GRACE_MS;
  });
}

/**
 * A deciding charge's status in OUR vocabulary (FUT-681).
 *
 * PagBank's cancel operation both VOIDS an unpaid charge and REFUNDS a paid
 * one, and answers `CANCELED` for either — the two are told apart by the
 * money: `amount.summary.refunded` is what actually went back. Collapsing both
 * into CANCELED hid every refund from the host (the ticket's "estornos são
 * invisíveis"); collapsing everything unpaid into PENDING made a canceled or
 * expired PIX poll "aguardando" forever.
 */
function chargeStatus(charge: PagBankOrderCharge): ChargeSnapshot['status'] {
  switch (charge.status) {
    case 'PAID':
      return 'PAID';
    case 'AUTHORIZED':
      return 'AUTHORIZED';
    case 'DECLINED':
      return 'DECLINED';
    case 'CANCELED':
      return refundedCents(charge) > 0 ? 'REFUNDED' : 'CANCELED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      // IN_ANALYSIS, WAITING, and whatever PagBank adds next: still live.
      return 'PENDING';
  }
}

/**
 * An order body's status: the deciding charge's, when one exists. An order
 * with NO charge is an unpaid PIX — PENDING while its QR can still be paid,
 * EXPIRED once every QR is past its deadline (plus {@link QR_EXPIRY_GRACE_MS}).
 */
function orderStatus(
  res: PagBankOrderResponse,
  charge: PagBankOrderCharge | undefined,
): ChargeSnapshot['status'] {
  if (charge) return chargeStatus(charge);
  return qrExpired(res, Date.now()) ? 'EXPIRED' : 'PENDING';
}

/**
 * Normalize an order body's charge into the shared snapshot shape.
 *
 * A PAID charge with no `amount.value` is REFUSED rather than normalized to 0
 * ({@link capturedAmountCents}). An unpaid PIX order legitimately carries no
 * charge — and so no amount — on every status poll, and stays PENDING.
 *
 * The order's own id rides along as `settlementHints.orderId` so every later
 * read knows which `/orders/{id}` to poll — `providerChargeId` cannot carry
 * that fact, because for a paid order it is the CHARGE's id (see FUT-681).
 */
export function orderSnapshot(
  res: PagBankOrderResponse,
  fallbackChargeId: string,
): ChargeSnapshot {
  const paid = settledCharge(res);
  const value = paid?.amount?.value;
  const settled = paid?.status === 'PAID';
  const captured = typeof value === 'number' ? value : undefined;
  return {
    provider: NAME,
    providerChargeId: typeof paid?.id === 'string' ? paid.id : fallbackChargeId,
    // The `reference_id` we sent, echoed back — see `ChargeSnapshot.reference`.
    ...(typeof res.reference_id === 'string' ? { reference: res.reference_id } : {}),
    status: orderStatus(res, paid),
    amount: { amountCents: capturedAmountCents(NAME, settled, captured), currency: 'BRL' },
    method: 'PIX',
    ...(typeof res.id === 'string' ? { settlementHints: { orderId: res.id } } : {}),
    raw: res,
  };
}

function pixQrText(res: PagBankPixResponse): string | undefined {
  return res.qr_codes?.[0]?.text ?? res.charges?.[0]?.qr_codes?.[0]?.text;
}

export function mapPix(
  res: PagBankPixResponse,
  input: ChargeInput,
  expiresAt: string,
): ChargeSnapshot {
  const providerOrderId = res.id;
  const qrText = pixQrText(res);
  if (!providerOrderId || !qrText) {
    throw new ProviderRequestError(NAME, 'PagBank PIX response missing order/qr fields.');
  }
  // An unpaid PIX order has NO charge — PagBank mints the charge only when the
  // buyer pays, so the real create response carries no `charges[]` at all
  // (FUT-681; the old fixtures inventing one is what hid this). The order id
  // is the only provider-side identity in existence and keys the row until a
  // webhook or poll names the real charge id; `settlementHints.orderId` labels
  // it as an ORDER id so that later read can re-key the row (see
  // `upsertByProviderChargeId`) instead of never finding it.
  const providerChargeId = res.charges?.[0]?.id ?? providerOrderId;
  return {
    provider: NAME,
    providerChargeId,
    // What `chargePayload` sent as `reference_id` — the correlation every
    // rescue path falls back to when ids alone cannot find the row.
    reference: input.reference,
    status: 'PENDING',
    amount: input.amount,
    method: 'PIX',
    pix: { qrText, expiresAt: res.qr_codes?.[0]?.expiration_date ?? expiresAt },
    settlementHints: { orderId: providerOrderId },
    raw: res,
  };
}

/**
 * A card charge's outcome. A decline is a business OUTCOME, never an
 * exception: checkout shows the buyer a message, not a stack trace.
 *
 * The reason comes from `payment_response.code`, not from the status — the
 * status only says "not paid". See `pagbank-declines.ts` for why the
 * provider's own retriability verdict is carried alongside the reason instead
 * of being folded into it.
 */
function cardOutcome(
  charge: PagBankCardCharge | undefined,
): Pick<ChargeSnapshot, 'status' | 'declineReason' | 'declineRetriable'> {
  if (charge?.status === 'PAID') return { status: 'PAID' };
  if (charge?.status === 'AUTHORIZED') return { status: 'AUTHORIZED' };
  const response = charge?.payment_response;
  const decline = pagbankDecline(response?.code, response?.raw_data);
  return {
    status: 'DECLINED',
    declineReason: decline.reason,
    declineRetriable: decline.retriable,
  };
}

export function mapCard(res: PagBankCardResponse, input: ChargeInput): ChargeSnapshot {
  if (!res.id) throw new ProviderRequestError(NAME, 'PagBank card response missing order id.');
  const charge = res.charges?.[0];
  if (!charge?.id) {
    throw new ProviderRequestError(NAME, 'PagBank card response missing charge id.');
  }
  const card = charge.payment_method?.card;
  return {
    provider: NAME,
    providerChargeId: charge.id,
    // `input.reference` is what `chargePayload` sent as `reference_id`; the
    // card response is built from the request, so it is authoritative here.
    reference: input.reference,
    ...cardOutcome(charge),
    amount: input.amount,
    method: 'CARD',
    // `vaultToken` is the id PagBank mints when it agreed to STORE the card —
    // normalized here so no host has to read this vendor payload itself.
    card: { brand: card?.brand, last4: card?.last_digits, vaultToken: card?.id },
    // The container the charge lives under — what `getCharge` polls, since
    // PagBank's read API is keyed by order, not by charge (FUT-681).
    settlementHints: { orderId: res.id },
    raw: res,
  };
}
