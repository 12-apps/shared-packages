import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ResolvedCredentials } from '../core/types';
import { NAME, pagbankRequest } from './pagbank-http';
import { orderSnapshot, type PagBankOrderCharge, type PagBankOrderResponse } from './pagbank-snapshots';
import { stubCapturedSnapshot, stubPendingSnapshot } from './shared';
import { stubFindChargeByReference } from './stub-fault';

/**
 * The PagBank adapter's read and capture operations, split out of `pagbank.ts`
 * (same seam as `stone-operations.ts` / `stripe-operations.ts`) so the adapter
 * file stays the identity + webhook contract and this one holds the calls.
 * Refunds live in `pagbank-refund.ts` (FUT-4571).
 *
 * The identity rule these operations encode (FUT-681): `providerChargeId` is a
 * CHARGE id (`CHAR_…`) wherever a charge exists, and the ORDER id (`ORDE_…`)
 * only for an unpaid PIX — the one state PagBank has no charge for. The two id
 * families are PagBank's own, printed on every id it mints, which is what lets
 * an operation handed a bare id still route it to the right endpoint when no
 * `orderId` hint survived (rows written before the hint existed).
 */

/** PagBank prefixes every order id `ORDE_…` and every charge id `CHAR_…`. */
export const ORDER_ID_PREFIX = /^orde/i;
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

/** The charge `chargeId` as its order reports it, or null when the read fails or lacks it. */
export async function chargeInOrder(
  orderId: string,
  chargeId: string,
  credentials: ResolvedCredentials,
  signal?: AbortSignal,
): Promise<PagBankOrderCharge | null> {
  const res = await pagbankRequest<PagBankOrderResponse>(
    `/orders/${encodeURIComponent(orderId)}`,
    credentials,
    { method: 'GET', ...(signal ? { signal } : {}) },
  ).catch(() => null);
  return res?.charges?.find((charge) => charge.id === chargeId) ?? null;
}

/** The amount a charge holds, in cents, or null when it names none. */
function authorizedCents(charge: PagBankOrderCharge): number | null {
  const value = charge.amount?.value;
  return typeof value === 'number' ? value : null;
}

/**
 * The AUTHORIZED charge a capture must name at `/charges/{id}/capture`, and
 * the amount it holds. Same routing as a refund's read-back
 * (`pagbank-refund.ts`): a charge id is read back through its order when the
 * row names one, an order id resolves to its AUTHORIZED charge, and an order
 * holding none is refused loudly — there is nothing honest to capture.
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
    return { chargeId: providerChargeId, cents: authorizedCents(charge) };
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
  return { chargeId: charge.id, cents: authorizedCents(charge) };
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
