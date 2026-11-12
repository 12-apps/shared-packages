import type {
  MerchantRef,
  PaymentsGateway,
  ProviderFailureReporter,
  RefundRefusal,
  RefundRetryStore,
} from "@12-apps/payments-backend";

/**
 * The subscription refund's ports and outcomes (FUT-4864) — what a host binds
 * and what it reads back. The flow is `./refund.ts`; every one of the host's
 * writes below is CONDITIONAL and answers whether it wrote, which is what makes
 * the flow safe to race.
 */

/** Where a subscription payment stands, as this flow needs to know it. */
export type RefundablePaymentState =
  /** Paid and not refunded: a refund may be claimed. */
  | "PAID"
  /** A refund was claimed and the money is not back yet. */
  | "REFUND_PENDING"
  /** Refunded already, by the provider or recorded by hand. */
  | "REFUNDED"
  /** Anything else (open, failed): never refundable. */
  | "OTHER";

/** Why a refund the flow asked for did not happen (yet). */
export type RefundPendingReason =
  | RefundRefusal
  /** The provider (or its adapter) does not refund at all. Nothing was sent. */
  | "UNSUPPORTED"
  /** The platform has no usable credentials at that provider any more. Nothing was sent. */
  | "NO_CREDENTIALS"
  /** The payment is paid but carries no provider charge (recorded by hand, say). */
  | "NO_CHARGE";

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
  /** What the provider took (with any instalment interest), in cents. */
  amountCents: number;
  currency: string;
  /** When the refund was claimed; null while PAID. */
  requestedAt: Date | null;
  /** The last recorded reason it is pending; null until an attempt answered. */
  pendingReason: RefundPendingReason | null;
}

/** How the money went back. */
export type RefundSettlement =
  /** The provider took a refund we sent. */
  | "PROVIDER"
  /** The provider showed the charge refunded already (an earlier answer lost, its own panel). */
  | "ADOPTED"
  /** A person recorded it returned another way. */
  | "BY_HAND";

/** What `markRefunded` is handed. */
export interface RefundRecord {
  how: RefundSettlement;
  /** The provider's refund id, when it gave one. */
  providerRefundId: string | null;
  /** What went back, in cents, when known (the snapshot's, or what the consult saw). */
  refundedCents: number | null;
  /** False while the provider is still processing a refund it accepted. */
  confirmed: boolean;
  at: Date;
  /** BY_HAND only: who recorded it, how it was returned and why (the host audits these). */
  byHand?: { by: string; via: string; reason: string };
}

/** What `markRefundPending` is handed. */
export interface RefundPendingRecord {
  reason: RefundPendingReason;
  /** The provider's own message, for an operator; never card or credential data. */
  message: string | null;
  at: Date;
}

/**
 * The host's subscription payment rows. Each write is CONDITIONAL and answers
 * whether it wrote: that is what makes the flow safe to race.
 */
export interface RefundablePaymentStore {
  find(paymentId: string): Promise<RefundablePayment | null>;
  /** PAID → REFUND_PENDING, stamping `requestedAt = at`; false when the row was not PAID any more. */
  claim(paymentId: string, at: Date): Promise<boolean>;
  /** REFUND_PENDING → REFUNDED; false when the row was not pending (refunded already). */
  markRefunded(paymentId: string, record: RefundRecord): Promise<boolean>;
  /** Record why it is pending, ONLY on a row still REFUND_PENDING; false otherwise. */
  markRefundPending(paymentId: string, record: RefundPendingRecord): Promise<boolean>;
}

/** Why nothing was asked of the provider. */
export type NotRefundableWhy =
  | "NOT_FOUND"
  /** Never paid (or, for `retry`, no refund was ever claimed). */
  | "NOT_PAID"
  | "ALREADY_REFUNDED"
  /** Another caller holds the claim (a second cancel, a retry while attempt 1 runs). */
  | "IN_PROGRESS";

export type SubscriptionRefundResult =
  | { outcome: "REFUNDED"; paymentId: string; method: string | null; record: RefundRecord }
  | { outcome: "PENDING"; paymentId: string; method: string | null; record: RefundPendingRecord }
  | { outcome: "NOT_REFUNDABLE"; paymentId: string; why: NotRefundableWhy };

export type SettleByHandResult =
  | { outcome: "REFUNDED"; paymentId: string; record: RefundRecord }
  | { outcome: "NOT_REFUNDABLE"; paymentId: string; why: NotRefundableWhy };

export interface SubscriptionRefund {
  /**
   * Refund one PAID payment in full: claim it, then send attempt 1. The host
   * decides beforehand that it should be refunded.
   */
  refund(paymentId: string, options?: { reason?: string }): Promise<SubscriptionRefundResult>;
  /**
   * A person asks again for a pending refund: a new series that consults the
   * charge before it sends. Refused (`NOT_PAID`) for a payment nobody claimed a
   * refund of, and (`IN_PROGRESS`) while an attempt may be running.
   */
  retry(paymentId: string): Promise<SubscriptionRefundResult>;
  /** A person returned the money another way: recorded, unless an attempt is in flight. */
  settleByHand(paymentId: string, byHand: { by: string; via: string; reason: string }): Promise<SettleByHandResult>;
  /** The sweep: run the background attempts that are due. Answers how many were looked at. */
  runDue(limit?: number): Promise<number>;
}

export interface SubscriptionRefundDeps {
  /**
   * The host's payments gateway, resolved per call — narrowed to the two
   * methods the retrier uses: refund, and the charge read it consults.
   */
  payments(): Promise<{ gateway: Pick<PaymentsGateway, "refund" | "refreshCharge"> }>;
  /** The merchant the payment was collected INTO — the platform's own account. */
  merchant: MerchantRef;
  /** The host's payment rows, built per call over its own database client. */
  store(): Promise<RefundablePaymentStore>;
  /**
   * The retry series rows, built per call. Kept apart from any other refund's
   * series (a store's order refunds): the sweep runs every due row of the store
   * it is given against THIS binding.
   */
  series(): Promise<RefundRetryStore>;
  /** The clock; injected for tests. */
  now?: () => Date;
  /** One attempt's provider deadline; the retrier's 90 s by default. */
  attemptMs?: number;
  /** Where a series that gave up is reported (once per series). */
  onProviderFailure?: ProviderFailureReporter;
}

/** What a subscription payment's series is opened under. */
export const SUBSCRIPTION_REFUND_SUBJECT = "subscription-payment";
