import { ProviderRequestError, UnsupportedOperationError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import { NOTHING_TO_REFUND } from '../core/refund-retry';
import type { Money, PaymentMethodKind, RefundSnapshot, ResolvedCredentials } from '../core/types';
import { NAME, pagbankRequest } from './pagbank-http';
import { chargeInOrder, ORDER_ID_PREFIX } from './pagbank-operations';
import {
  chargeMethod,
  refundedCents,
  settledCharge,
  type PagBankOrderCharge,
  type PagBankOrderResponse,
} from './pagbank-snapshots';
import { stubRefund } from './shared';

export { classifyPagBankRefundRefusal } from './pagbank-rejections';

/**
 * PagBank refunds: `POST /charges/{id}/cancel`, full or partial (FUT-680,
 * FUT-681, FUT-4571).
 *
 * A cancel with `amount.value` below what is left refunds PART of a card
 * charge: PagBank answers the charge still `PAID`, with `amount.summary.refunded`
 * moved — a CUMULATIVE figure. A cancel that returns the rest answers
 * `CANCELED`. So a partial is judged against the refunded figure read back
 * BEFORE the cancel, and is never sent when that figure cannot be read.
 */

/** The methods PagBank refunds in part. Pix waits for a sandbox run (owner, FUT-4571). */
export const PARTIAL_REFUND_METHODS: readonly PaymentMethodKind[] = ['CARD'];

type ChargeBody = PagBankOrderCharge & { id?: unknown };

/** What is still refundable on a charge, in cents, or null when it names no amount. */
function refundableCents(charge: PagBankOrderCharge): number | null {
  const value = charge.amount?.value;
  return typeof value === 'number' ? Math.max(0, value - refundedCents(charge)) : null;
}

/** `GET /charges/{id}`: the fallback read for a row that never learned its order. */
function readCharge(chargeId: string, credentials: ResolvedCredentials): Promise<ChargeBody> {
  return pagbankRequest<ChargeBody>(`/charges/${encodeURIComponent(chargeId)}`, credentials, {
    method: 'GET',
  });
}

/**
 * The charge a refund must name at `/charges/{id}/cancel`, as PagBank reports
 * it now.
 *
 * A refund handed an ORDER id — a PIX row created before the paid webhook
 * re-keyed it, or one written before FUT-681 — cannot be sent there verbatim:
 * the endpoint 404s on anything but a charge id. Resolve it through the order
 * instead, and refuse loudly when the order holds no settled charge, because
 * "refund an order nobody paid" has no honest charge to act on.
 *
 * A charge id is read back too — through its ORDER whenever the stored charge
 * names one. The second sandbox evidence run (FUT-3722) answered
 * `GET /charges/{id}` with 406 for a charge the Orders API had just created,
 * while `GET /orders/{id}` kept answering, so the order is the read to trust
 * and the charge read is only the fallback.
 *
 * `lenient` (a FULL refund only) answers a failed charge read with null, so
 * the cancel can still go: it returns whatever is left, whatever that is. A
 * partial is never lenient — its answer cannot be judged without the figure.
 */
async function refundTarget(
  providerChargeId: string,
  credentials: ResolvedCredentials,
  options: { orderId?: string; lenient: boolean },
): Promise<{ chargeId: string; charge: PagBankOrderCharge | null }> {
  if (!ORDER_ID_PREFIX.test(providerChargeId)) {
    const { orderId } = options;
    const inOrder = orderId ? await chargeInOrder(orderId, providerChargeId, credentials) : null;
    if (inOrder) return { chargeId: providerChargeId, charge: inOrder };
    const read = readCharge(providerChargeId, credentials);
    return { chargeId: providerChargeId, charge: options.lenient ? await read.catch(() => null) : await read };
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
  return { chargeId: charge.id, charge };
}

/**
 * PagBank cancel response → normalized refund status (FUT-680), for a FULL
 * refund and for any answer a partial does not judge by its summary.
 *
 * `CANCELED` is the only status that says the money went (or is going) back.
 * A charge that comes back still `PAID` (or in any other live state) is the
 * provider saying the cancel did NOT take. An unrecognized or missing status
 * is PENDING: a refund this code does not understand is one it must not
 * declare complete.
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

/** What a cancel response says went back, cumulative, else the charge's value. */
function reportedRefundCents(res: PagBankOrderCharge): number {
  const refunded = refundedCents(res);
  if (refunded > 0) return refunded;
  const value = res.amount?.value;
  return typeof value === 'number' ? value : 0;
}

function cancel(chargeId: string, value: number | null, credentials: ResolvedCredentials) {
  // A full refund names its amount too (FUT-3722): the sandbox answered a
  // body-less cancel with 400 invalid_parameter. Only a charge that names no
  // amount is cancelled without a body. Never retried once possibly sent: the
  // cancel carries no idempotency key, and a second one refunds twice.
  return pagbankRequest<ChargeBody>(`/charges/${encodeURIComponent(chargeId)}/cancel`, credentials, {
    method: 'POST',
    ...(value !== null ? { body: { amount: { value } } } : {}),
  });
}

/**
 * A full refund: whatever is left on the charge. On a charge never refunded it
 * behaves exactly as before FUT-4571 (same calls, body, id and amount). After
 * a partial it reports only what THIS cancel returned, under its own id.
 */
async function fullRefund(
  providerChargeId: string,
  credentials: ResolvedCredentials,
  orderId: string | undefined,
): Promise<RefundSnapshot> {
  const { chargeId, charge } = await refundTarget(providerChargeId, credentials, { orderId, lenient: true });
  const value = charge ? refundableCents(charge) : null;
  if (value === 0) {
    throw new ProviderRequestError(NAME, `PagBank charge ${chargeId} has nothing left to refund.`, {
      providerCode: NOTHING_TO_REFUND,
      retriable: false,
    });
  }
  const res = await cancel(chargeId, value, credentials);
  if (!charge && hasRefundSummary(res)) return unprovenRefund(providerChargeId, chargeId, res);
  return fullOutcome(providerChargeId, chargeId, charge ? refundedCents(charge) : 0, value, res);
}

/**
 * A full cancel's answer, judged against the refunded figure read before it
 * (0 when there was none to read). On a never-refunded charge: main's id and
 * amount, unchanged. After a partial: the delta, under its own id (D4).
 */
function fullOutcome(
  providerChargeId: string,
  chargeId: string,
  before: number,
  value: number | null,
  res: ChargeBody,
): RefundSnapshot {
  const after = refundedCents(res);
  const earlier = before > 0;
  return {
    provider: NAME,
    providerChargeId,
    providerRefundId: earlier
      ? refundIdOf(chargeId, before + (value ?? after - before))
      : typeof res.id === 'string' ? res.id : chargeId,
    // The response decides — a hardcoded REFUNDED is the bug FUT-680 names.
    status: refundStatusOf(res.status),
    amount: {
      amountCents: earlier ? (after > before ? after - before : (value ?? 0)) : reportedRefundCents(res),
      currency: 'BRL',
    },
    raw: res,
  };
}

function hasRefundSummary(res: PagBankOrderCharge): boolean {
  return typeof res.amount?.summary?.refunded === 'number';
}

/**
 * A full refund whose read-back failed, answered with a cumulative summary:
 * with no before-figure, the summary cannot say how much of it THIS cancel
 * returned (an earlier partial may hold part of it). So it is PENDING, under
 * no amount, for a person to reconcile, never REFUNDED at the cumulative
 * figure (FUT-4571, D4). An answer with no summary at all keeps the FUT-680
 * reading, which an existing test pins.
 */
function unprovenRefund(providerChargeId: string, chargeId: string, res: ChargeBody): RefundSnapshot {
  return {
    provider: NAME,
    providerChargeId,
    providerRefundId: refundIdOf(chargeId, refundedCents(res)),
    status: refundStatusOf(res.status) === 'REFUNDED' ? 'PENDING' : refundStatusOf(res.status),
    amount: { amountCents: 0, currency: 'BRL' },
    raw: res,
  };
}

/**
 * A refund's id. PagBank's cancel names no refund object, so two partials on
 * one charge are told apart by the cumulative refunded figure each one brings
 * the charge to — deterministic, and the figure a later webhook carries.
 */
function refundIdOf(chargeId: string, refundedAfter: number): string {
  return `${chargeId}:${refundedAfter}`;
}

/**
 * Judge a partial cancel's answer against the refunded figure read before it.
 * REFUNDED only when PagBank proves it: CANCELED (the rest went back), or PAID
 * with `summary.refunded` grown by exactly the requested amount. Grown by a
 * different amount is PENDING — money moved, but not as asked, so a person
 * reconciles it. Not grown, or no summary, is FAILED: the cancel did not take.
 */
function judgePartial(
  res: PagBankOrderCharge,
  before: number,
  requested: number,
): { status: RefundSnapshot['status']; cents: number } {
  const grew = refundedCents(res) - before;
  // CANCELED proves the rest went back. Never report more than THIS cancel
  // asked: a refund sent at the same time may share the growth.
  if (res.status === 'CANCELED') {
    return { status: 'REFUNDED', cents: grew > 0 ? Math.min(grew, requested) : requested };
  }
  if (res.status !== 'PAID') return { status: refundStatusOf(res.status), cents: requested };
  if (grew === requested) return { status: 'REFUNDED', cents: requested };
  // Grown otherwise: PENDING under the amount THIS refund asked for — the rest
  // of the growth may be another refund's, sent at the same time.
  return { status: grew > 0 ? 'PENDING' : 'FAILED', cents: requested };
}

/**
 * The charge a partial may be sent to, or a refusal before anything is sent:
 * a method PagBank is not trusted to refund in part (Pix, today), or an amount
 * above what is left on the charge.
 */
function assertPartialAllowed(chargeId: string, charge: PagBankOrderCharge, cents: number): void {
  const method = chargeMethod(charge);
  if (method === null || !PARTIAL_REFUND_METHODS.includes(method)) {
    throw new UnsupportedOperationError(NAME, `partial refunds of ${method ?? 'unknown-method'} charges`);
  }
  const left = refundableCents(charge);
  if (left === null || cents <= 0 || cents > left) {
    throw new ProviderRequestError(
      NAME,
      `PagBank charge ${chargeId} cannot refund ${cents} cents: ${left ?? 'an unknown amount'} left.`,
      { retriable: false },
    );
  }
}

/** A refund of `amount`, part of the charge, judged against a read-back made first. */
async function partialRefund(
  providerChargeId: string,
  amount: Money,
  credentials: ResolvedCredentials,
  orderId: string | undefined,
): Promise<RefundSnapshot> {
  const cents = amount.amountCents;
  const { chargeId, charge } = await refundTarget(providerChargeId, credentials, { orderId, lenient: false });
  if (!charge) throw new ProviderRequestError(NAME, `PagBank charge ${chargeId} could not be read back.`);
  assertPartialAllowed(chargeId, charge, cents);
  const before = refundedCents(charge);
  const res = await cancel(chargeId, cents, credentials);
  const judged = judgePartial(res, before, cents);
  // A refund of a whole never-refunded charge keeps the bare charge id, as a
  // full refund does; every other one is named by the figure it reaches — the
  // answer's own when it moved, so two partials sent at once keep two ids.
  const whole = before === 0 && cents === charge.amount?.value;
  const after = refundedCents(res);
  return {
    provider: NAME,
    providerChargeId,
    providerRefundId: whole ? chargeId : refundIdOf(chargeId, after > before ? after : before + cents),
    status: judged.status,
    amount: { amountCents: judged.cents, currency: amount.currency },
    raw: res,
  };
}

export const refund: NonNullable<PaymentProviderAdapter['refund']> = async (
  input,
  credentials,
  hints,
) => {
  if (credentials.stub) return stubRefund(NAME, input);
  return input.amount
    ? partialRefund(input.providerChargeId, input.amount, credentials, hints?.orderId)
    : fullRefund(input.providerChargeId, credentials, hints?.orderId);
};
