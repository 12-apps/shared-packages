import type { ChargeSnapshot, NormalizedWebhookEvent, ResolvedCredentials, WebhookDelivery } from '../core/types';
import { stubDeliveryTrusted } from '../core/stub-mode';
import { NAME, paymentCheck } from './infinitepay-http';
import { checkSnapshot, type InfinitePayWebhookBody } from './infinitepay-shared';
import { sha256Hex } from './shared';

/**
 * The InfinitePay webhook half — the only confirmation path that always has
 * what it needs.
 *
 * `payment_check` demands `transaction_nsu` and `slug` together with the
 * reference, and neither exists before somebody pays: the live `/links` API
 * answers with an opaque `?lenc=` URL carrying no invoice code at all. The
 * delivery carries both. That makes this not a redundancy over polling but the
 * mechanism, with polling as the thing that cannot work alone.
 *
 * Its own module so the adapter stays inside the size gate.
 */

/**
 * Authenticate a delivery by ASKING INFINITEPAY, not by trusting the body.
 *
 * There is deliberately NO shared-secret header check here. InfinitePay sends
 * no headers a merchant can configure — no signature, no secret, nothing — so
 * a `webhookSecret` gate can never be satisfied by a GENUINE delivery. This is
 * not hypothetical: a production store had one configured, and every real
 * notification InfinitePay sent it was rejected at that gate, before
 * `payment_check` could run, for days. The stored `webhookSecret` field is
 * ignored for exactly that reason, and the credential schema no longer offers
 * it.
 *
 * The real control is the network call below: a delivery is believed only if
 * InfinitePay itself confirms the payment when re-asked. A forger can therefore
 * only "confirm" money that actually moved into the merchant's own account —
 * and the shortfall guard downstream refuses a real-but-small payment
 * presented against a larger order.
 */
export async function verifyInfinitePayWebhook(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<boolean> {
  if (stubDeliveryTrusted(credentials)) return true;

  let body: InfinitePayWebhookBody;
  try {
    body = JSON.parse(delivery.rawBody) as InfinitePayWebhookBody;
  } catch {
    return false;
  }
  // Without a correlation key there is nothing to confirm against — reject.
  if (!body.order_nsu) return false;

  try {
    const check = await paymentCheck(credentials, {
      orderNsu: body.order_nsu,
      transactionNsu: body.transaction_nsu,
      slug: body.slug ?? body.invoice_slug,
    });
    return check.success === true || check.paid === true;
  } catch {
    // FAIL CLOSED. An unconfirmable delivery is not a delivery; InfinitePay
    // will retry, and a real payment also surfaces on the next `getCharge`.
    return false;
  }
}

/**
 * The settled charge behind a VERIFIED delivery, read from the SAME trusted
 * source that verified it.
 *
 * `verify` already re-asked InfinitePay whether this payment is real, so PAID
 * is sound. THE AMOUNT IS NOT: the delivery is unsigned, so `body.amount` is
 * an anonymous caller's claim about someone else's payment. Believing it is
 * not a rounding concern — a host that compares the captured amount against
 * what the order is worth would park a fully-paid order on `{"amount": 1}`,
 * and refuse a good payment outright when the field is simply absent. So the
 * amount comes from `payment_check`, exactly like the paid flag does, and the
 * body is left to supply only the correlation key.
 */
async function settledSnapshot(
  body: InfinitePayWebhookBody,
  credentials: ResolvedCredentials,
): Promise<ChargeSnapshot> {
  const reference = body.order_nsu ?? '';
  // Stub mode makes no network call anywhere in this adapter (local dev / CI
  // parity), so the body IS the fixture there — but a stub body still may not
  // invent an amount it never carried.
  if (stubDeliveryTrusted(credentials)) {
    return checkSnapshot({ ...body, success: true, order_nsu: reference }, {
      reference,
      currency: 'BRL',
    });
  }
  const slug = body.slug ?? body.invoice_slug;
  const check = await paymentCheck(credentials, {
    orderNsu: reference,
    transactionNsu: body.transaction_nsu,
    slug,
  });
  // The delivery names it `invoice_slug`; every other surface calls it `slug`.
  // Carried onto the snapshot so it survives past this request.
  return checkSnapshot(check, { reference, currency: 'BRL', ...(slug ? { slug } : {}) });
}

/**
 * Parse an already-VERIFIED delivery. Reaching here means `payment_check`
 * confirmed the payment, so reporting PAID is sound — the body's own `paid`
 * flag is never what decides it, and neither is its `amount`.
 */
export async function parseInfinitePayEvent(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<NormalizedWebhookEvent[]> {
  const body = JSON.parse(delivery.rawBody) as InfinitePayWebhookBody;
  return [
    {
      provider: NAME,
      // InfinitePay sends no delivery id; the transaction id is the next best
      // dedup key, falling back to a body hash.
      eventId: body.transaction_nsu ?? sha256Hex(delivery.rawBody),
      type: 'CHARGE_UPDATED',
      charge: await settledSnapshot(body, credentials),
      raw: body,
    },
  ];
}

/**
 * The delivery's own correlation key (FUT-726). InfinitePay echoes the
 * reference `createCharge` sent as `order_nsu` on every callback, so that
 * field — and only that field — says which charge a stored delivery names.
 * Declared on the adapter beside `verifyConfirmsPayment` because
 * reconciliation needs the pair: the flag says a PROCESSED row proves
 * payment, this says WHOSE. Takes the raw stored payload string (what an
 * inbox durably holds); a body that does not parse answers null.
 */
export function infinitePayDeliveryReference(payload: string): string | null {
  try {
    const body = JSON.parse(payload) as { order_nsu?: unknown };
    return typeof body.order_nsu === 'string' ? body.order_nsu : null;
  } catch {
    return null;
  }
}
