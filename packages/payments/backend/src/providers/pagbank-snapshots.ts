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

export interface PagBankOrderResponse {
  reference_id?: unknown;
  charges?: Array<{ id?: unknown; status?: unknown; amount?: { value?: unknown } }>;
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

/**
 * Normalize an order body's charge into the shared snapshot shape.
 *
 * A PAID charge with no `amount.value` is REFUSED rather than normalized to 0
 * ({@link capturedAmountCents}). An unpaid PIX order legitimately carries no
 * charge — and so no amount — on every status poll, and stays PENDING.
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
    status: settled ? 'PAID' : 'PENDING',
    amount: { amountCents: capturedAmountCents(NAME, settled, captured), currency: 'BRL' },
    method: 'PIX',
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
  const providerChargeId = res.charges?.[0]?.id ?? providerOrderId;
  if (!providerOrderId || !providerChargeId || !qrText) {
    throw new ProviderRequestError(NAME, 'PagBank PIX response missing order/charge/qr fields.');
  }
  return {
    provider: NAME,
    providerChargeId,
    status: 'PENDING',
    amount: input.amount,
    method: 'PIX',
    pix: { qrText, expiresAt: res.qr_codes?.[0]?.expiration_date ?? expiresAt },
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
    raw: res,
  };
}
