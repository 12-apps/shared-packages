import {
  isAccountAccessError,
  providerRejectionReasons,
  rejectionReasonsOfBody,
  type ProviderRejectionReason,
} from '../core/error-readers';
import { ProviderRequestError } from '../core/errors';
import type { RefundRefusal } from '../core/refund-retry';

/**
 * WHICH buyer field PagBank refused, read from its own error vocabulary
 * (FUT-764).
 *
 * The pipeline must never branch on a vendor's error strings — that is stated
 * in `checkout/refusal.ts` and it is why `mapProviderError` is a host callback.
 * But the vocabulary itself is not the host's either: `40002`,
 * `customer.email`, `tax_id` and `customer.name` are PagBank's, identical for
 * every deployment, and they belong beside the adapter that produces them. The
 * first adopting host carried the whole table, so its checkout branched on
 * another company's error codes.
 *
 * What this returns is a REASON, never a sentence and never a field name: which
 * of its own inputs a host calls `taxId` (`cpf`, `documento`, `tax_id`) and
 * what it tells a buyer are both the host's, and neither travels.
 *
 * `null` means "PagBank did not say anything this maps to" — the caller falls
 * through to the walk's own outcome rather than inventing one.
 */
export type PagBankRejection =
  /**
   * 401/403: the store's credentials are missing or invalid. A configuration
   * problem the buyer cannot fix, so a host should steer them to paying another
   * way rather than suggesting they check their own details.
   */
  | 'ACCOUNT_ACCESS'
  /**
   * The buyer's e-mail equals the PagBank merchant account's, which the API
   * forbids. Reached almost exclusively by an owner testing their own store.
   */
  | 'EMAIL_EQUALS_MERCHANT'
  | 'INVALID_TAX_ID'
  | 'INVALID_NAME';

export function classifyPagBankRejection(error: unknown): PagBankRejection | null {
  if (isAccountAccessError(error)) return 'ACCOUNT_ACCESS';

  // Read from the STRUCTURED reasons rather than regexed out of the message:
  // the adapter caps a message at 300 characters, so a payload running past it
  // silently matched nothing.
  return rejectionOfReasons(providerRejectionReasons(error));
}

/**
 * The same reading over a recorded error PAYLOAD (FUT-4322): the evidence keeps
 * each call's body, while the error a failover walk throws wraps the provider's
 * and loses it. One predicate, two ways in.
 */
export function classifyPagBankRejectionBody(body: unknown): PagBankRejection | null {
  return rejectionOfReasons(rejectionReasonsOfBody(body));
}

function rejectionOfReasons(reasons: readonly ProviderRejectionReason[]): PagBankRejection | null {
  for (const reason of reasons) {
    const parameter = reason.parameterName ?? '';
    if (reason.code === '40002' && parameter === 'customer.email') return 'EMAIL_EQUALS_MERCHANT';
    if (parameter.includes('tax_id')) return 'INVALID_TAX_ID';
    if (parameter.includes('customer.name')) return 'INVALID_NAME';
  }
  return null;
}

/**
 * What PagBank's refusal of a REFUND means (FUT-4360): `NOT_YET` for
 * `40008 refund_temporarily_unavailable` ("Transaction is not found", answered
 * to a cancel sent while the charge is still settling), `REFUSED` for any other
 * answer of PagBank's that waiting cannot change, `UNKNOWN` for everything
 * else — a 5xx, a timeout, a transport error — where the refund may even have
 * happened. Read from the STRUCTURED reasons and the HTTP status, never from
 * the message.
 */
export function classifyPagBankRefundRefusal(error: unknown): RefundRefusal {
  if (!(error instanceof ProviderRequestError)) return 'UNKNOWN';
  if (providerRejectionReasons(error).some((reason) => reason.code === '40008')) return 'NOT_YET';
  const status = error.options.httpStatus;
  // 408 and 429 are the provider saying "later", not "no".
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'REFUSED' : 'UNKNOWN';
}
