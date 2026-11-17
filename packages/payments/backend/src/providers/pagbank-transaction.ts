/**
 * A PagBank charge's transaction identifiers → {@link ChargeTransaction}
 * (FUT-2239).
 *
 * Read from PagBank's published order object:
 *   - `charges[].paid_at` — "Data e horário em que a cobrança foi paga (capturada)";
 *   - `charges[].payment_method.pix.end_to_end_id` — "Id fim a fim da transação";
 *   - `charges[].payment_response.raw_data.{nsu, authorization_code}` — the
 *     acquirer trace (example quoted in `pagbank-declines.ts`), with
 *     `payment_response.reference` — "NSU da autorização" — as the NSU's fallback.
 *
 * The order object documents no txid for the dynamic QR PagBank mints, so none
 * is reported: a txid guessed from the QR text would be a wrong id on a fiscal
 * document. When PagBank publishes one, it is read here.
 *
 * The card trace is reported for an APPROVAL only (PAID or AUTHORIZED). A
 * decline's `raw_data` carries an authorisation-code-shaped field too, and a
 * host must never be able to file it as the code of a payment that happened.
 */
import type { ChargeTransaction } from '../core/types';

import type { PagBankPaymentRawData } from './pagbank-declines';

/**
 * PagSeguro Internet Instituição de Pagamento S.A. — CNPJ 08.561.701/0001-01.
 * The PSP of every PagBank charge, so the adapter's own constant: never read
 * off an end-to-end id, whose ISPB names the PAYER's bank.
 */
export const PAGBANK_PSP_CNPJ_BASE = '08561701';

/** The acquirer trace a payment response may carry, beyond the decline fields. */
export interface PagBankTraceRawData extends PagBankPaymentRawData {
  nsu?: unknown;
  authorization_code?: unknown;
}

/** As much of a charge as the transaction ids are read from. */
export interface PagBankTransactionCharge {
  status?: unknown;
  paid_at?: unknown;
  payment_response?: { code?: unknown; reference?: unknown; raw_data?: PagBankTraceRawData };
  payment_method?: { type?: unknown; pix?: { end_to_end_id?: unknown } };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** PagBank's local-offset timestamp as UTC ISO-8601, or nothing when unreadable. */
function instant(value: unknown): string | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function approved(status: unknown): boolean {
  return status === 'PAID' || status === 'AUTHORIZED';
}

function cardTrace(charge: PagBankTransactionCharge): Pick<ChargeTransaction, 'nsu' | 'authorizationCode'> {
  if (!approved(charge.status)) return {};
  const response = charge.payment_response;
  const nsu = text(response?.raw_data?.nsu) ?? text(response?.reference);
  const authorizationCode = text(response?.raw_data?.authorization_code);
  return { ...(nsu ? { nsu } : {}), ...(authorizationCode ? { authorizationCode } : {}) };
}

/**
 * The transaction a PagBank charge names. Always carries the PSP; the rest
 * only when the charge reports it. `undefined` charge — an unpaid Pix order
 * with no charge yet — names the PSP alone.
 */
export function pagbankTransaction(charge: PagBankTransactionCharge | undefined): ChargeTransaction {
  if (!charge) return { pspCnpjBase: PAGBANK_PSP_CNPJ_BASE };
  const endToEndId = text(charge.payment_method?.pix?.end_to_end_id);
  const settledAt = instant(charge.paid_at);
  return {
    ...(endToEndId ? { endToEndId } : {}),
    ...cardTrace(charge),
    ...(settledAt ? { settledAt } : {}),
    pspCnpjBase: PAGBANK_PSP_CNPJ_BASE,
  };
}
