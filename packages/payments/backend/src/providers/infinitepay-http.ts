import type { CustomerSchema, ResolvedCredentials } from '../core/types';
import { providerFetch } from './http';

/**
 * InfinitePay transport (Checkout Integrado).
 *
 * InfinitePay's integration model is checkout-link first and, unusually, the
 * link API carries NO API key: a store is identified only by its handle (the
 * InfiniteTag). Two consequences drive this adapter's design:
 *
 *   1. There is nothing to OAuth against and nothing to keep secret, so
 *      connecting is a single text field.
 *   2. Because a handle is public, and because deliveries arrive UNSIGNED,
 *      an inbound "paid" notification proves nothing on its own. This module
 *      therefore exposes `paymentCheck`, and the adapter re-asks InfinitePay
 *      whether a payment is real before believing any webhook.
 */

export const NAME = 'infinitepay';

/**
 * What InfinitePay asks of the buyer (FUT-595). Its checkout page demands a
 * mobile number; name and e-mail it takes as optional pre-fill. There is
 * deliberately NO `taxId` entry: the link payload has no tax-id field, so a
 * CPF must never be asked for an InfinitePay charge, let alone block one.
 *
 * The phone is REQUIRED even though `POST /links` accepts a payload without
 * it, because the declaration describes what the BUYER must ultimately
 * provide: what we send is a pre-fill for the page that will insist on it.
 * The charge walk knows a REDIRECT provider's own page is the collector and
 * does not block on this (`gateCustomerRequirements`), but a host that
 * collects ahead spares the buyer typing it twice.
 *
 * The type is `MOBILE`, not `PHONE`: the page insists on a MOBILE, so a
 * landline pre-filled here is accepted by us and then rejected there — the
 * buyer types the phone twice, the one outcome collecting ahead exists to
 * prevent. `PHONE` (landline-or-mobile) stays the right rule for PagBank,
 * whose splitter forwards both; see the `CustomerFieldType` doc.
 */
export const customerSchema: CustomerSchema = [
  { key: 'name', type: 'NAME', required: false },
  { key: 'email', type: 'EMAIL', required: false },
  { key: 'phone', type: 'MOBILE', required: true },
];

const API_BASE = 'https://api.checkout.infinitepay.io';

/**
 * No credential-field override: a stored field is tenant-supplied data, and
 * letting it name the origin we call would hand a store admin an SSRF
 * primitive (and, for providers that send a secret, an exfiltration one).
 * InfinitePay serves checkout from this single host.
 */

/** The InfiniteTag is stored and displayed with `$`, but sent without it. */
export function handleOf(credentials: ResolvedCredentials): string {
  return (credentials.fields['handle'] ?? '').trim().replace(/^\$/, '');
}

async function post<T>(
  path: string,
  credentials: ResolvedCredentials,
  body: Record<string, unknown>,
): Promise<T> {
  return providerFetch<T>(NAME, 'InfinitePay', `${API_BASE}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface InfinitePayLinkResponse {
  url?: string;
  slug?: string;
  id?: string;
}

export async function createCheckoutLink(
  credentials: ResolvedCredentials,
  body: Record<string, unknown>,
): Promise<InfinitePayLinkResponse> {
  return post<InfinitePayLinkResponse>('/links', credentials, body);
}

/** What `payment_check` answers — the authoritative view of a payment. */
export interface InfinitePayPaymentCheck {
  success?: boolean;
  paid?: boolean;
  amount?: number;
  capture_method?: string;
  installments?: number;
  order_nsu?: string;
  transaction_nsu?: string;
  receipt_url?: string;
}

/**
 * Ask InfinitePay whether a payment actually happened.
 *
 * This is the adapter's ONLY trusted source of truth about settlement — called
 * from `webhook.verify` (a delivery is believed only if InfinitePay confirms
 * it) and from `getCharge` / `findChargeByReference`.
 *
 * ## All four fields are mandatory. Measured, not documented.
 *
 *     {handle, order_nsu, transaction_nsu, slug}
 *       → {"success":true,"paid":true,"amount":101,"paid_amount":101,
 *          "installments":1,"capture_method":"credit_card"}
 *     the same call missing `slug`             → {"success":false}
 *     the same call missing `transaction_nsu`  → {"success":false}
 *     a reference that never existed           → {"success":false}
 *
 * The last line is the trap. A partial question is not answered more weakly —
 * it is answered IDENTICALLY to nonsense, with HTTP 200, so "not paid yet" and
 * "you did not ask properly" are indistinguishable. A bad handle is the only
 * case that differs (404 `{"success":false,"message":"Not found"}`).
 *
 * ## And neither extra field exists before the payment
 *
 * `POST /links` answers with exactly one key — `{"url": "…?lenc=<blob>.v1.<mac>"}`
 * — no `slug`, no path segment, and the blob is encrypted rather than encoded,
 * so nothing is derivable from it. `transaction_nsu` does not exist until money
 * moves. Both appear together in exactly two places: the post-payment REDIRECT
 * (`?slug=…&transaction_nsu=…&transaction_id=…&order_nsu=…&capture_method=…&receipt_url=…`)
 * and the WEBHOOK body (as `invoice_slug` + `transaction_nsu`).
 *
 * That is why this adapter cannot confirm by polling alone, and why the webhook
 * is the mechanism rather than a redundancy.
 */
export async function paymentCheck(
  credentials: ResolvedCredentials,
  params: { orderNsu: string; transactionNsu?: string; slug?: string },
): Promise<InfinitePayPaymentCheck> {
  return post<InfinitePayPaymentCheck>('/payment_check', credentials, {
    handle: handleOf(credentials),
    order_nsu: params.orderNsu,
    transaction_nsu: params.transactionNsu,
    slug: params.slug,
  });
}
