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
import { stubCapturedSnapshot, stubPendingSnapshot, stubRefund } from './shared';
import { stubFindChargeByReference } from './stub-fault';

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
  if (credentials.stub) return stubFindChargeByReference(NAME, credentials);
  const res = await pagbankRequest<{ orders?: Array<PagBankOrderResponse & { id?: string }> }>(
    `/orders?reference_id=${encodeURIComponent(reference)}`,
    credentials,
    { method: 'GET' },
  );
  const order = res.orders?.[0];
  if (!order?.id) return null;
  return orderSnapshot(order, order.id);
};

/** What is still refundable on a charge, in cents, or null when it names no amount. */
function refundableCents(charge: PagBankOrderCharge): number | null {
  const value = charge.amount?.value;
  return typeof value === 'number' ? Math.max(0, value - refundedCents(charge)) : null;
}

/**
 * The charge a refund must name at `/charges/{id}/cancel`, and what is still
 * refundable on it.
 *
 * A refund handed an ORDER id — a PIX row created before the paid webhook
 * re-keyed it, or one written before FUT-681 — cannot be sent there verbatim:
 * the endpoint 404s on anything but a charge id. Resolve it through the order
 * instead, and refuse loudly when the order holds no settled charge, because
 * "refund an order nobody paid" has no honest charge to act on.
 *
 * A charge id is read back too, because the cancel needs its amount (see
 * `refund`) — through its ORDER whenever the stored charge names one. The
 * second sandbox evidence run (FUT-3722) answered `GET /charges/{id}` with 406
 * for a charge the Orders API had just created, while `GET /orders/{id}` kept
 * answering, so the order is the read to trust and the charge read is only
 * the fallback for a row that never learned its order.
 */
async function refundTarget(
  providerChargeId: string,
  credentials: ResolvedCredentials,
  orderId?: string,
): Promise<{ chargeId: string; cents: number | null }> {
  if (!ORDER_ID_PREFIX.test(providerChargeId)) {
    const inOrder = orderId ? await chargeInOrder(orderId, providerChargeId, credentials) : null;
    // A failed read must not block a refund the body-less cancel may still
    // perform: fall back to it rather than throwing before the cancel.
    const charge =
      inOrder ??
      (await pagbankRequest<PagBankOrderCharge>(
        `/charges/${encodeURIComponent(providerChargeId)}`,
        credentials,
        { method: 'GET' },
      ).catch(() => null));
    return { chargeId: providerChargeId, cents: charge ? refundableCents(charge) : null };
  }
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
  return { chargeId: charge.id, cents: refundableCents(charge) };
}

/** The charge `chargeId` as its order reports it, or null when the read fails or lacks it. */
async function chargeInOrder(
  orderId: string,
  chargeId: string,
  credentials: ResolvedCredentials,
): Promise<PagBankOrderCharge | null> {
  const res = await pagbankRequest<PagBankOrderResponse>(
    `/orders/${encodeURIComponent(orderId)}`,
    credentials,
    { method: 'GET' },
  ).catch(() => null);
  return res?.charges?.find((charge) => charge.id === chargeId) ?? null;
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
  hints,
) => {
  if (credentials.stub) return stubRefund(NAME, input);
  // A caller naming its amount on a charge id needs no read-back.
  const { chargeId, cents } =
    input.amount && !ORDER_ID_PREFIX.test(input.providerChargeId)
      ? { chargeId: input.providerChargeId, cents: null }
      : await refundTarget(input.providerChargeId, credentials, hints?.orderId);
  // A full refund names its amount too (FUT-3722): the sandbox answered a
  // body-less cancel with 400 invalid_parameter, and every example in
  // PagBank's cancel reference sends `amount.value`, the full-refund one
  // included. The remaining amount comes from the charge itself; only a
  // charge that names none is cancelled without a body.
  const value = input.amount ? input.amount.amountCents : cents;
  if (value === 0) {
    throw new ProviderRequestError(NAME, `PagBank charge ${chargeId} has nothing left to refund.`, {
      retriable: false,
    });
  }
  const res = await pagbankRequest<PagBankOrderCharge & { id?: string }>(
    `/charges/${encodeURIComponent(chargeId)}/cancel`,
    credentials,
    {
      method: 'POST',
      ...(value !== null ? { body: { amount: { value } } } : {}),
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

/**
 * The AUTHORIZED charge a capture must name at `/charges/{id}/capture`, and
 * the amount it holds. Same routing as {@link refundTarget}: a charge id is
 * read back through its order when the row names one, an order id resolves to
 * its AUTHORIZED charge, and an order holding none is refused loudly — there
 * is nothing honest to capture.
 */
async function captureTarget(
  providerChargeId: string,
  credentials: ResolvedCredentials,
  orderId?: string,
): Promise<{ chargeId: string; cents: number | null }> {
  if (!ORDER_ID_PREFIX.test(providerChargeId)) {
    const inOrder = orderId ? await chargeInOrder(orderId, providerChargeId, credentials) : null;
    const charge =
      inOrder ??
      (await pagbankRequest<PagBankOrderCharge>(
        `/charges/${encodeURIComponent(providerChargeId)}`,
        credentials,
        { method: 'GET' },
      ));
    return { chargeId: providerChargeId, cents: typeof charge.amount?.value === 'number' ? charge.amount.value : null };
  }
  const res = await pagbankRequest<PagBankOrderResponse>(
    `/orders/${encodeURIComponent(providerChargeId)}`,
    credentials,
    { method: 'GET' },
  );
  const charge = res.charges?.find((c) => c.status === 'AUTHORIZED');
  if (typeof charge?.id !== 'string') {
    throw new ProviderRequestError(
      NAME,
      `PagBank order ${providerChargeId} carries no authorized charge to capture.`,
      { retriable: false },
    );
  }
  return { chargeId: charge.id, cents: typeof charge.amount?.value === 'number' ? charge.amount.value : null };
}

/**
 * Capture an AUTHORIZED charge in full (FUT-4082): `POST
 * /charges/{id}/capture`, whose `amount.value` PagBank requires. The caller's
 * amount (the stored row's) is used when known, else the charge's own. The
 * response is the charge as it now stands — `PAID` once the capture took —
 * mapped as `getCharge` maps a bare charge.
 */
export const captureCharge: NonNullable<PaymentProviderAdapter['captureCharge']> = async (
  input,
  credentials,
  hints,
) => {
  if (credentials.stub) return stubCapturedSnapshot(NAME, input);
  const { chargeId, cents } =
    input.amount && !ORDER_ID_PREFIX.test(input.providerChargeId)
      ? { chargeId: input.providerChargeId, cents: input.amount.amountCents }
      : await captureTarget(input.providerChargeId, credentials, hints?.orderId);
  const value = input.amount?.amountCents ?? cents;
  if (value === null) {
    throw new ProviderRequestError(NAME, `PagBank charge ${chargeId} names no amount to capture.`, {
      retriable: false,
    });
  }
  const charge = await pagbankRequest<PagBankOrderCharge & { reference_id?: unknown }>(
    `/charges/${encodeURIComponent(chargeId)}/capture`,
    credentials,
    { method: 'POST', body: { amount: { value } } },
  );
  // The order id rides back in as the snapshot's hint, so the persisted row
  // keeps the `/orders/{id}` its later reads go through (FUT-3722).
  return orderSnapshot({ id: hints?.orderId, reference_id: charge.reference_id, charges: [charge] }, chargeId);
};
