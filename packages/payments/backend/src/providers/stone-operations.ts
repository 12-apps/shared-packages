import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ResolvedCredentials } from '../core/types';
import type { StoneCopy } from './copy';
import { unreachableOutcome } from './probe-shared';
import { stubCharge, stubPendingSnapshot, stubRefund } from './shared';
import { NAME, stoneRequest } from './stone-http';
import {
  methodOf,
  orderPayload,
  orderSnapshot,
  settledCharge,
  type StoneCharge,
  type StoneOrder,
} from './stone-orders';

/**
 * The Stone adapter's operations, split out so `stone.ts` stays the ADAPTER
 * (identity, capabilities, webhooks) and this file holds the calls it makes.
 */

export function verifyCredentialsWith(
  copy: StoneCopy,
): NonNullable<PaymentProviderAdapter['verifyCredentials']> {
  return async (credentials) => {
    if (credentials.stub) return { ok: true, message: 'stub mode' };
    if (!credentials.fields['secretKey']) {
      return { ok: false, message: copy.secretKeyMissing };
    }
    try {
      // Cheapest authenticated probe: one page of orders. A wrong key → 401.
      await stoneRequest('/orders?size=1', credentials, { method: 'GET' });
      return { ok: true };
    } catch (error) {
      // Transport first: without the UNREACHABLE fault, a network blip during
      // "Testar conexão" persisted FAILED over a good key (FUT-695).
      const unreachable = unreachableOutcome(error, copy.unreachable);
      if (unreachable) return unreachable;
      const status = error instanceof ProviderRequestError ? error.options.httpStatus : undefined;
      if (status === 401 || status === 403) {
        return { ok: false, fault: 'REFUSED', message: copy.refused };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  };
}

export function createChargeWith(
  copy: StoneCopy,
): NonNullable<PaymentProviderAdapter['createCharge']> {
  return async (input, credentials) => {
    if (credentials.stub) return stubCharge(NAME, input, credentials);
    const order = await stoneRequest<StoneOrder>('/orders', credentials, {
      method: 'POST',
      body: orderPayload(input, copy),
      idempotencyKey: input.idempotencyKey ?? input.reference,
    });
    // A refused card comes back as a 200 carrying a `failed` charge — mapped to
    // a DECLINED snapshot by `orderSnapshot`, never thrown.
    return orderSnapshot(order, {
      amountCents: input.amount.amountCents,
      currency: input.amount.currency,
      method: input.method,
    });
  };
}

/**
 * Fetch whatever a provider charge id points at, normalized to an order.
 * Charge ids (`ch_...`) resolve through the charge endpoint, which answers
 * with a bare charge; order ids are fetched directly.
 */
async function fetchOrder(
  providerChargeId: string,
  credentials: ResolvedCredentials,
): Promise<StoneOrder> {
  if (providerChargeId.startsWith('ch_')) {
    const charge = await stoneRequest<StoneCharge>(
      `/charges/${encodeURIComponent(providerChargeId)}`,
      credentials,
      { method: 'GET' },
    );
    return { charges: [charge] };
  }
  return stoneRequest<StoneOrder>(`/orders/${encodeURIComponent(providerChargeId)}`, credentials, {
    method: 'GET',
  });
}

export const getCharge: PaymentProviderAdapter['getCharge'] = async (
  providerChargeId,
  credentials,
) => {
  if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
  const order = await fetchOrder(providerChargeId, credentials);
  const charge = settledCharge(order);
  // A poll KNOWS nothing about the amount beyond what Pagar.me just said, so
  // it supplies no fallback — a paid charge with no amount is refused.
  return orderSnapshot(order, {
    currency: charge?.currency ?? 'BRL',
    method: methodOf(charge, 'PIX'),
    id: providerChargeId,
  });
};

/**
 * Reconciliation probe. `createCharge` sends the host reference as the order
 * `code`, and Pagar.me lets orders be filtered by it — a direct read of the
 * orders collection, so an order created moments before a timeout is visible
 * immediately rather than after some index catches up.
 *
 * Errors propagate on purpose: the walk must distinguish "Pagar.me says no
 * such order" from "Pagar.me did not answer", and only the first is proof
 * that charging elsewhere is safe.
 */
export const findChargeByReference: NonNullable<
  PaymentProviderAdapter['findChargeByReference']
> = async (reference, credentials) => {
  if (credentials.stub) return null;
  const res = await stoneRequest<{ data?: StoneOrder[] }>(
    `/orders?code=${encodeURIComponent(reference)}`,
    credentials,
    { method: 'GET' },
  );
  const order = res.data?.[0];
  if (!order?.id) return null;
  const charge = settledCharge(order);
  return orderSnapshot(order, {
    currency: charge?.currency ?? 'BRL',
    method: methodOf(charge, 'PIX'),
    id: order.id,
  });
};

export const cancelCharge: NonNullable<PaymentProviderAdapter['cancelCharge']> = async (
  providerChargeId,
  credentials,
) => {
  if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
  const charge = await stoneRequest<StoneCharge>(
    `/charges/${encodeURIComponent(providerChargeId)}`,
    credentials,
    { method: 'DELETE' },
  );
  return orderSnapshot(
    { charges: [charge] },
    {
      currency: charge.currency ?? 'BRL',
      method: methodOf(charge, 'PIX'),
      id: providerChargeId,
    },
  );
};

export const refund: NonNullable<PaymentProviderAdapter['refund']> = async (input, credentials) => {
  if (credentials.stub) return stubRefund(NAME, input);
  // Pagar.me refunds by DELETEing the charge; an `amount` makes it partial.
  const charge = await stoneRequest<StoneCharge>(
    `/charges/${encodeURIComponent(input.providerChargeId)}`,
    credentials,
    {
      method: 'DELETE',
      body: input.amount ? { amount: input.amount.amountCents } : undefined,
    },
  );
  const settled = charge.status === 'refunded' || charge.status === 'partial_refunded';
  return {
    provider: NAME,
    providerChargeId: input.providerChargeId,
    providerRefundId: charge.id ?? input.providerChargeId,
    status: settled ? 'REFUNDED' : 'PENDING',
    amount: input.amount ?? { amountCents: charge.amount ?? 0, currency: 'BRL' },
    raw: charge,
  };
};
