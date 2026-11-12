import {
  CredentialsError,
  isNothingToRefund,
  refundRefusalOf,
  UnsupportedOperationError,
  type MerchantRef,
  type PaymentsGateway,
  type RefundSnapshot,
} from "@12-apps/payments-backend";

/**
 * Subscription REFUND (FUT-4864) — returning one paid subscription payment to
 * the customer, through the provider that took it.
 *
 * ## What is here, and what is not
 *
 * Here is the MECHANISM: which charge is refunded (the stored one, in full, so
 * an instalment charge returns everything the provider took), at which merchant
 * (the platform's, the same inversion collection rests on), how a provider's
 * answer becomes one of three outcomes, and that a refund the provider did not
 * take is RECORDED as pending rather than thrown away.
 *
 * What stays in the HOST is every opinion: WHEN a payment is refundable (a
 * withdrawal window, from which payment it counts, whether a renewal reopens
 * it), what a cancel does to the plan, who may ask for a refund, who settles a
 * pending one by hand and how that is audited. This module refunds what it is
 * told to refund, once the host has decided it should.
 *
 * ## The channel
 *
 * A provider refund goes back by the channel the charge was paid through — a
 * Pix charge is returned to the payer's key, a card charge to the card. Nothing
 * here chooses it, and nothing could: `gateway.refund` refunds a charge, not an
 * amount to a destination. The payment's `method` is handed back on every
 * outcome so the host's copy can say which one.
 *
 * ## Three outcomes, and which ones write
 *
 *  - `REFUNDED` — the provider took the refund (its snapshot says REFUNDED or
 *    PENDING: a Pix refund is commonly asynchronous, and once accepted it is
 *    the provider's to complete), or answered that the charge has nothing left
 *    to refund (an earlier attempt whose answer was lost, a refund made in the
 *    provider's panel). `markRefunded` is called.
 *  - `PENDING` — the provider did not refund: it refused, it does not refund
 *    at all, it gave no answer, or the payment carries no charge to refund.
 *    `markRefundPending` is called with why, so a person can settle it.
 *  - `NOT_REFUNDABLE` — nothing to do: no such payment, a payment that was
 *    never paid, or one already refunded. NOTHING is written.
 *
 * A refund with NO answer (a timeout, a 5xx) is PENDING, not failed: the money
 * may have gone back. A later {@link SubscriptionRefund.retry} is safe for
 * exactly that reason — the provider answers "nothing to refund" and the retry
 * adopts it as done instead of refunding twice.
 *
 * Server-only.
 */

/** Where a subscription payment stands, as this flow needs to know it. */
export type RefundablePaymentState =
  /** Paid and not refunded: a refund may be raised. */
  | "PAID"
  /** A refund was asked for and the provider did not take it: a retry may be raised. */
  | "REFUND_PENDING"
  /** Refunded already, by the provider or recorded by hand. */
  | "REFUNDED"
  /** Anything else (pending, failed): never refundable. */
  | "OTHER";

/** One subscription payment, as the host's own row maps onto it. */
export interface RefundablePayment {
  id: string;
  state: RefundablePaymentState;
  /** The provider key the charge was raised at; null when no charge was raised. */
  provider: string | null;
  /** The provider's charge id; null when no charge was raised. */
  providerChargeId: string | null;
  /** How it was paid (PIX | CARD | …), handed back for the host's copy. */
  method: string | null;
  /** The cycle's principal, for the host's copy. A full refund returns what the provider took. */
  amountCents: number;
  currency: string;
}

/** Why a refund the flow asked for did not happen. */
export type RefundPendingReason =
  /** The provider answered no, for good. */
  | "REFUSED"
  /** The provider said "not yet". */
  | "NOT_YET"
  /** No verdict: a timeout, a 5xx, a transport error. The money may have gone back. */
  | "UNKNOWN"
  /** The provider (or its adapter) does not refund at all. */
  | "UNSUPPORTED"
  /** The platform has no usable credentials at that provider any more. */
  | "NO_CREDENTIALS"
  /** The payment is paid but carries no provider charge (recorded by hand, say). */
  | "NO_CHARGE";

/** What `markRefunded` is handed. */
export interface RefundRecord {
  /** The provider's refund id; null when the provider answered "nothing to refund". */
  providerRefundId: string | null;
  /** True when the provider said REFUNDED (or nothing left); false while it is processing it. */
  confirmed: boolean;
  at: Date;
}

/** What `markRefundPending` is handed. */
export interface RefundPendingRecord {
  reason: RefundPendingReason;
  /** The provider's own message, for an operator; never card or credential data. */
  message: string | null;
  at: Date;
}

/** The host's subscription payment rows, as the refund reads and writes them. */
export interface RefundablePaymentStore {
  find(paymentId: string): Promise<RefundablePayment | null>;
  markRefunded(paymentId: string, record: RefundRecord): Promise<void>;
  markRefundPending(paymentId: string, record: RefundPendingRecord): Promise<void>;
}

export type SubscriptionRefundResult =
  | { outcome: "REFUNDED"; paymentId: string; method: string | null; record: RefundRecord }
  | { outcome: "PENDING"; paymentId: string; method: string | null; record: RefundPendingRecord }
  | { outcome: "NOT_REFUNDABLE"; paymentId: string; why: "NOT_FOUND" | "NOT_PAID" | "ALREADY_REFUNDED" };

export interface SubscriptionRefund {
  /**
   * Refund one PAID payment in full (a `REFUND_PENDING` one is retried, which
   * is the same act). The host decides beforehand that it should be refunded.
   */
  refund(paymentId: string, options?: { reason?: string }): Promise<SubscriptionRefundResult>;
  /**
   * Ask the provider again for a payment whose refund is pending. Refuses
   * (`NOT_REFUNDABLE`, `NOT_PAID`) a payment that never asked for one, so a
   * "Tentar de novo" can never become the first refund of a payment nobody
   * decided to refund.
   */
  retry(paymentId: string, options?: { reason?: string }): Promise<SubscriptionRefundResult>;
}

export interface SubscriptionRefundDeps {
  /**
   * The host's payments gateway, resolved per call — narrowed to the one
   * method this flow uses, so it cannot charge, vault or rotate anything.
   */
  payments(): Promise<{ gateway: Pick<PaymentsGateway, "refund"> }>;
  /** The merchant the payment was collected INTO — the platform's own account. */
  merchant: MerchantRef;
  /** The host's payment rows, built per call over its own database client. */
  store(): Promise<RefundablePaymentStore>;
  /** The clock; injected for tests. */
  now?: () => Date;
}

/** A provider's message, trimmed to what an operator can read in one line. */
function messageOf(error: unknown): string | null {
  if (!(error instanceof Error) || error.message.trim() === "") return null;
  return error.message.trim().slice(0, 500);
}

/** Why a thrown refund did not happen, in this package's words. */
function pendingReasonOf(error: unknown): RefundPendingReason {
  if (error instanceof UnsupportedOperationError) return "UNSUPPORTED";
  if (error instanceof CredentialsError) return "NO_CREDENTIALS";
  return refundRefusalOf(error);
}

/** A snapshot the provider answered with, as an outcome. */
function recordOfSnapshot(snapshot: RefundSnapshot, at: Date): RefundRecord | RefundPendingRecord {
  if (snapshot.status === "FAILED") return { reason: "REFUSED", message: null, at };
  return { providerRefundId: snapshot.providerRefundId, confirmed: snapshot.status === "REFUNDED", at };
}

export function createSubscriptionRefund(deps: SubscriptionRefundDeps): SubscriptionRefund {
  const now = deps.now ?? (() => new Date());

  async function pending(
    store: RefundablePaymentStore,
    payment: RefundablePayment,
    record: RefundPendingRecord,
  ): Promise<SubscriptionRefundResult> {
    await store.markRefundPending(payment.id, record);
    return { outcome: "PENDING", paymentId: payment.id, method: payment.method, record };
  }

  async function refunded(
    store: RefundablePaymentStore,
    payment: RefundablePayment,
    record: RefundRecord,
  ): Promise<SubscriptionRefundResult> {
    await store.markRefunded(payment.id, record);
    return { outcome: "REFUNDED", paymentId: payment.id, method: payment.method, record };
  }

  async function ask(
    store: RefundablePaymentStore,
    payment: RefundablePayment,
    reason: string | undefined,
  ): Promise<SubscriptionRefundResult> {
    if (!payment.provider || !payment.providerChargeId) {
      return pending(store, payment, { reason: "NO_CHARGE", message: null, at: now() });
    }
    let snapshot: RefundSnapshot;
    try {
      const { gateway } = await deps.payments();
      snapshot = await gateway.refund(deps.merchant, payment.provider, {
        providerChargeId: payment.providerChargeId,
        reason,
      });
    } catch (error) {
      if (isNothingToRefund(error)) {
        return refunded(store, payment, { providerRefundId: null, confirmed: true, at: now() });
      }
      return pending(store, payment, { reason: pendingReasonOf(error), message: messageOf(error), at: now() });
    }
    const record = recordOfSnapshot(snapshot, now());
    return "reason" in record ? pending(store, payment, record) : refunded(store, payment, record);
  }

  async function run(
    paymentId: string,
    accepts: readonly RefundablePaymentState[],
    reason: string | undefined,
  ): Promise<SubscriptionRefundResult> {
    const store = await deps.store();
    const payment = await store.find(paymentId);
    if (!payment) return { outcome: "NOT_REFUNDABLE", paymentId, why: "NOT_FOUND" };
    if (payment.state === "REFUNDED") return { outcome: "NOT_REFUNDABLE", paymentId, why: "ALREADY_REFUNDED" };
    if (!accepts.includes(payment.state)) return { outcome: "NOT_REFUNDABLE", paymentId, why: "NOT_PAID" };
    return ask(store, payment, reason);
  }

  return {
    refund: (paymentId, options) => run(paymentId, ["PAID", "REFUND_PENDING"], options?.reason),
    retry: (paymentId, options) => run(paymentId, ["REFUND_PENDING"], options?.reason),
  };
}
