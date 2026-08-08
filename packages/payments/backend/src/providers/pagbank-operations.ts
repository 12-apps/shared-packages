import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { RefundSnapshot, ResolvedCredentials } from '../core/types';
import { NAME, pagbankRequest } from './pagbank-http';
import {
  orderSnapshot,
  refundedCents,
  settledCharge,
  type PagBankOrderCharge,
  type PagBankOrderResponse,
} from './pagbank-snapshots';
import { stubPendingSnapshot, stubRefund } from './shared';

/**
 * The PagBank adapter's read/refund operations, split out of `pagbank.ts`
 * (same seam as `stone-operations.ts` / `stripe-operations.ts`) so the adapter
 * file stays the identity + webhook contract and this one holds the calls.
 *
 * The identity rule these operations encode (FUT-681): `providerChargeId` is a
 * CHARGE id (`CHAR_…`) wherever a charge exists, and the ORDER id (`ORDE_…`)
 * only for an unpaid PIX — the one state PagBank has no charge for. The two id
 * families are PagBank's own, printed on every id it mints, which is what lets
 * an operation handed a bare id still route it to the right endpoint when no
 * `orderId` hint survived (rows written before the hint existed).
 */

/** PagBank prefixes every order id `ORDE_…` and every charge id `CHAR_…`. */
const ORDER_ID_PREFIX = /^orde/i;
const CHARGE_ID_PREFIX = /^char/i;

async function readOrder(
  orderId: string,
  fallbackChargeId: string,
  credentials: ResolvedCredentials,
) {
  const res = await pagbankRequest<PagBankOrderResponse>(
    `/orders/${encodeURIComponent(orderId)}`,
    credentials,
    { method: 'GET' },
  );
  return orderSnapshot(res, fallbackChargeId);
}

/**
 * Poll a charge's current state — the webhook fallback, so it must answer for
 * BOTH shapes of stored row:
 *
 *   - `hints.orderId` present (every row this version writes): poll
 *     `/orders/{orderId}`, which answers for paid and unpaid alike;
 *   - a bare `CHAR_…` id (card rows written before the hint existed): poll
 *     `/charges/{id}` — `/orders/{CHAR_…}` is the 404 the ticket names;
 *   - anything else is an order id (unpaid-PIX rows, old and new): poll
 *     `/orders/{id}`, exactly as before.
 */
export const getCharge: PaymentProviderAdapter['getCharge'] = async (
  providerChargeId,
  credentials,
  hints,
) => {
  if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
  const orderId = hints?.orderId;
  if (orderId) return readOrder(orderId, providerChargeId, credentials);
  if (!CHARGE_ID_PREFIX.test(providerChargeId)) {
    return readOrder(providerChargeId, providerChargeId, credentials);
  }
  const charge = await pagbankRequest<PagBankOrderCharge & { reference_id?: unknown }>(
    `/charges/${encodeURIComponent(providerChargeId)}`,
    credentials,
    { method: 'GET' },
  );
  // A bare charge body is a one-charge order to the mapping layer — same
  // status/amount rules, no second code path to keep honest.
  return orderSnapshot({ reference_id: charge.reference_id, charges: [charge] }, providerChargeId);
};

/**
 * Reconciliation probe. PagBank indexes orders by the `reference_id` we set
 * at creation, so an order created moments before a timeout is findable
 * immediately — this reads the orders collection directly, with no search
 * index in between and therefore no staleness window.
 *
 * Errors deliberately propagate: the walk must be able to tell "PagBank says
 * there is no such order" from "PagBank did not answer", and only the former
 * is proof that it is safe to charge somewhere else.
 */
export const findChargeByReference: NonNullable<
  PaymentProviderAdapter['findChargeByReference']
> = async (reference, credentials) => {
  if (credentials.stub) return null;
  const res = await pagbankRequest<{ orders?: Array<PagBankOrderResponse & { id?: string }> }>(
    `/orders?reference_id=${encodeURIComponent(reference)}`,
    credentials,
    { method: 'GET' },
  );
  const order = res.orders?.[0];
  if (!order?.id) return null;
  return orderSnapshot(order, order.id);
};

/**
 * The charge a refund must name at `/charges/{id}/cancel`.
 *
 * A refund handed an ORDER id — a PIX row created before the paid webhook
 * re-keyed it, or one written before FUT-681 — cannot be sent there verbatim:
 * the endpoint 404s on anything but a charge id. Resolve it through the order
 * instead, and refuse loudly when the order holds no settled charge, because
 * "refund an order nobody paid" has no honest charge to act on.
 */
async function refundableChargeId(
  providerChargeId: string,
  credentials: ResolvedCredentials,
): Promise<string> {
  if (!ORDER_ID_PREFIX.test(providerChargeId)) return providerChargeId;
  const res = await pagbankRequest<PagBankOrderResponse>(
    `/orders/${encodeURIComponent(providerChargeId)}`,
    credentials,
    { method: 'GET' },
  );
  const charge = settledCharge(res);
  if (typeof charge?.id !== 'string') {
    throw new ProviderRequestError(
      NAME,
      `PagBank order ${providerChargeId} carries no charge to refund.`,
      { retriable: false },
    );
  }
  return charge.id;
}

/**
 * PagBank cancel response → normalized refund status (FUT-680).
 *
 * The cancel endpoint answers with the CHARGE as it now stands, so `CANCELED`
 * is the only status that says the money went (or is going) back. A charge
 * that comes back still `PAID` (or in any other live state) is the provider
 * saying the cancel did NOT take — a terminal "no", never a success. An
 * unrecognized or missing status is PENDING: a refund this code does not
 * understand is one it must not declare complete. Mirrors the Stripe
 * `refundStatusOf` contract ("reports a failed refund as FAILED, not
 * REFUNDED").
 */
function refundStatusOf(status: unknown): RefundSnapshot['status'] {
  switch (status) {
    case 'CANCELED':
      return 'REFUNDED';
    case 'PAID':
    case 'AUTHORIZED':
    case 'IN_ANALYSIS':
    case 'DECLINED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/** What the cancel response says actually went back, in cents. */
function reportedRefundCents(res: PagBankOrderCharge): number {
  const refunded = refundedCents(res);
  if (refunded > 0) return refunded;
  const value = res.amount?.value;
  return typeof value === 'number' ? value : 0;
}

export const refund: NonNullable<PaymentProviderAdapter['refund']> = async (
  input,
  credentials,
) => {
  if (credentials.stub) return stubRefund(NAME, input);
  const chargeId = await refundableChargeId(input.providerChargeId, credentials);
  // NO body for a full refund: PagBank documents an omitted `amount` as
  // "cancel the total". The old body was `{"amount":{}}` — `partialRefunds` is
  // false, so the gateway never passes an amount and `value` was always
  // undefined — an accidental shape asserting nothing. An explicit amount
  // still travels for the caller that has one (partial, capability-gated).
  const res = await pagbankRequest<PagBankOrderCharge & { id?: string }>(
    `/charges/${encodeURIComponent(chargeId)}/cancel`,
    credentials,
    {
      method: 'POST',
      ...(input.amount ? { body: { amount: { value: input.amount.amountCents } } } : {}),
    },
  );
  return {
    provider: NAME,
    providerChargeId: input.providerChargeId,
    providerRefundId: typeof res.id === 'string' ? res.id : chargeId,
    // The response decides — a hardcoded REFUNDED here is the bug FUT-680
    // names: the same file whose `capturedAmountCents` refuses to fabricate
    // amounts was fabricating refund outcomes.
    status: refundStatusOf(res.status),
    // Prefer what the provider reports as returned; the requested amount only
    // stands in when the response names none.
    amount: input.amount ?? { amountCents: reportedRefundCents(res), currency: 'BRL' },
    raw: res,
  };
};
