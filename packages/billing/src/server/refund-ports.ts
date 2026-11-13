import type {
  MerchantRef,
  PaymentsGateway,
  ProviderFailureReporter,
  RefundRefusal,
  RefundRetryStore,
  WebhookEventHandler,
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
  | "NO_CHARGE"
  /**
   * A person said the provider never returned a refund it had accepted, past
   * the confirmation deadline (`markNotReturned`).
   */
  | "NOT_RETURNED";

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
  /**
   * The refund REQUEST this payment is under, as the host stored it from
   * `claim` (or `reopen`) and returns it unchanged; null when none was stored
   * (a request made before this field existed). The retry series is bound to
   * it, so a refund asked for again is a new series.
   */
  requestId: string | null;
  /**
   * The provider refund a person said never came back, kept from `reopen`
   * (`notReturnedRefundId`); null on any other payment.
   */
  notReturnedRefundId: string | null;
  /**
   * True once this binding asked the provider for a refund again after that
   * (`sendingAgain`). A charge read that later sees the money back can then
   * not tell which refund it was; while false, the money seen back is the
   * refund said never returned.
   */
  sentAgain: boolean;
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
  /**
   * PAID → REFUND_PENDING, stamping `requestedAt = at` and storing `requestId`
   * (returned unchanged by `find`); false when the row was not PAID any more.
   */
  claim(paymentId: string, at: Date, requestId: string): Promise<boolean>;
  /** REFUND_PENDING → REFUNDED; false when the row was not pending (refunded already). */
  markRefunded(paymentId: string, record: RefundRecord): Promise<boolean>;
  /** Record why it is pending, ONLY on a row still REFUND_PENDING; false otherwise. */
  markRefundPending(paymentId: string, record: RefundPendingRecord): Promise<boolean>;
  /**
   * Called BEFORE every refund this binding sends: on a payment reopened
   * NOT_RETURNED (it carries a `notReturnedRefundId`) the host records that a
   * second refund was asked for, at `at`, ONLY when none is recorded yet, so
   * `find` answers `sentAgain: true`. A no-op for any other payment. Keyed by
   * the charge, the one handle the provider call carries. Recorded before the
   * call so a process that dies mid-send still leaves it.
   */
  sendingAgain(provider: string, providerChargeId: string, at: Date): Promise<void>;
  /**
   * The send recorded at `at` provably moved no money (a FAILED answer, an
   * answered refusal, or refused before dispatch): clear the record ONLY if it
   * is still that one (`at`), so an earlier send that may have moved money
   * keeps it.
   */
  sentNothing(provider: string, providerChargeId: string, at: Date): Promise<void>;
}

/** A refund recorded unconfirmed (`confirmed: false`), waiting for the provider to finish it. */
export interface UnconfirmedRefund {
  id: string;
  provider: string | null;
  providerChargeId: string | null;
  /** The provider's id of the refund recorded; a FAILED update for another refund is not this one's. */
  providerRefundId: string | null;
  /** When the refund was recorded: the confirmation deadline counts from here. */
  refundedAt: Date;
}

/**
 * The host's rows of refunds recorded unconfirmed. Every write is conditional
 * on the row still being REFUNDED and unconfirmed, and answers whether it wrote.
 */
export interface RefundConfirmationStore {
  /** Unconfirmed refunds, the least recently followed first (so an overdue one never starves the rest). */
  unconfirmed(limit: number): Promise<readonly UnconfirmedRefund[]>;
  /** The unconfirmed refund of one provider charge, or null. */
  findByCharge(provider: string, providerChargeId: string): Promise<UnconfirmedRefund | null>;
  /** One payment's unconfirmed refund, or null (not refunded, or confirmed). */
  findUnconfirmed(paymentId: string): Promise<UnconfirmedRefund | null>;
  /** The provider finished it: mark it confirmed. */
  confirm(paymentId: string, at: Date): Promise<boolean>;
  /**
   * Followed and not finished yet. `overdue` once the host's deadline passed:
   * the host shows it to a person — the refund stays REFUNDED (the provider
   * may still finish it), so nobody may return the money again.
   */
  followed(paymentId: string, at: Date, overdue: boolean): Promise<void>;
  /**
   * The provider said the refund FAILED, or a person said it was never
   * returned: REFUNDED → REFUND_PENDING with `record`, the refund asked for
   * again at `record.at` under `requestId` (the payment's new `requestedAt` and
   * `requestId`), for a person.
   */
  reopen(paymentId: string, record: ReopenRecord): Promise<boolean>;
  /**
   * The payment whose refund `providerRefundId` of that charge was reopened
   * NOT_RETURNED (the id `reopen` was handed as `notReturnedRefundId`), as it
   * stands now — still pending, or returned since — or null. Read when that
   * refund lands after all.
   */
  findNotReturned(provider: string, providerChargeId: string, providerRefundId: string): Promise<NotReturnedRefund | null>;
  /**
   * The refund reopened NOT_RETURNED landed AFTER the payment was returned
   * again (by hand, or by a second refund): the customer got the money twice.
   * Recorded once on the row for a person (the host surfaces and audits it);
   * false when it was recorded already.
   */
  doubleReturned(paymentId: string, record: { providerRefundId: string; at: Date }): Promise<boolean>;
}

/** What `reopen` is handed. */
export interface ReopenRecord extends RefundPendingRecord {
  requestId: string;
  /** NOT_RETURNED only: who said so and why (the host audits these with the write). */
  byHand?: NotReturnedBy;
  /**
   * NOT_RETURNED only: the provider's id of the refund said never returned.
   * The host KEEPS it on the row: if that refund lands after all, its update
   * finds the payment by it (`findNotReturned`). Null when the provider gave none.
   */
  notReturnedRefundId?: string | null;
}

/** A payment reopened NOT_RETURNED, as `findNotReturned` reads it. */
export interface NotReturnedRefund {
  id: string;
  /** REFUND_PENDING: not returned again yet. REFUNDED: returned again since. */
  state: "REFUND_PENDING" | "REFUNDED";
  /**
   * REFUNDED only: the provider's refund id recorded by what returned it again
   * — the refund said never returned itself when a charge read adopted it with
   * no second send (its late word is then no double return); null by hand, or
   * when a charge read adopted money after a second send (which refund it was
   * is unknown, so its late word is a double return).
   */
  settledRefundId: string | null;
}

/**
 * Who said a refund was never returned, and why — handed to `reopen` so the
 * host records it with the row (its audit trail) in one write.
 */
export interface NotReturnedBy {
  by: string;
  reason: string;
}

export type NotReturnedResult =
  | {
      outcome: "REOPENED";
      paymentId: string;
      record: RefundPendingRecord;
      /**
       * What the last charge read said: NOT_BACK, or UNREADABLE — the provider
       * could not be asked, so the reopen rests on the person's word alone
       * (the host says so to them).
       */
      chargeRead: "NOT_BACK" | "UNREADABLE";
    }
  | {
      outcome: "NOT_REOPENED";
      paymentId: string;
      /**
       * NOT_FOUND: no unconfirmed refund on that payment (never refunded, or
       * confirmed long ago). NOT_OVERDUE: still inside the deadline.
       * MONEY_BACK: the charge read shows the money returned — the refund was
       * confirmed instead. ALREADY_RESOLVED: a confirm, a provider update or
       * another person's mark won the race between the read and the write.
       * INCOMPLETE: who said so, or why, was blank — nothing was read or written.
       */
      why: "NOT_FOUND" | "NOT_OVERDUE" | "MONEY_BACK" | "ALREADY_RESOLVED" | "INCOMPLETE";
    };

/**
 * What the provider's word on a refund did. ADOPTED: a refund reopened
 * NOT_RETURNED landed after all and was recorded returned. DOUBLE_RETURN: it
 * landed after the payment had been returned again — recorded for a person.
 */
export type RefundUpdateOutcome = "CONFIRMED" | "REOPENED" | "ADOPTED" | "DOUBLE_RETURN" | "IGNORED";

/** What one `confirmDue` pass came to. */
export interface ConfirmationPass {
  confirmed: number;
  /** Still unfinished past the deadline: flagged for a person, never reopened. */
  overdue: number;
  /** Still unfinished, inside the deadline. */
  waiting: number;
  /** Rows whose own write threw; the pass went on past them. */
  failed: number;
}

/** A provider's word on a refund (a webhook), as the host hands it in. */
export interface RefundUpdate {
  provider: string;
  providerChargeId: string;
  providerRefundId: string;
  status: "PENDING" | "REFUNDED" | "FAILED";
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
  | {
      outcome: "NOT_REFUNDABLE";
      paymentId: string;
      /**
       * On a payment reopened NOT_RETURNED the charge is read first, since the
       * refund said never returned may still land. MONEY_BACK: it did — the
       * payment was recorded returned (ADOPTED), nothing settled by hand.
       * CHARGE_UNREADABLE: the provider could not be asked; settle later.
       */
      why: NotRefundableWhy | "MONEY_BACK" | "CHARGE_UNREADABLE";
    };

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
  /**
   * The sweep's other half: follow the refunds recorded unconfirmed. A charge
   * read back REFUNDED (or a PAID charge voided) confirms one; one still
   * unfinished — or unreadable — past `confirmations.confirmWithinMs` is
   * flagged overdue for a person and stays REFUNDED: a charge read cannot tell
   * a refund still processing from one that failed. Needs `confirmations`.
   */
  confirmDue(limit?: number): Promise<ConfirmationPass>;
  /**
   * The provider's own word on a refund (its webhook): REFUNDED confirms the
   * unconfirmed refund of that charge; FAILED — the only evidence of a failed
   * refund — reopens it as pending (REFUSED), asked for again under a new
   * request; PENDING changes nothing. Needs `confirmations`.
   */
  refundUpdated(update: RefundUpdate): Promise<RefundUpdateOutcome>;
  /**
   * `refundUpdated`, shaped as payments-backend's `WebhookEventHandler`, for a
   * host to hand to ONE delivery (`handleWebhook(…, { onWebhookEvent })`): a
   * REFUND_UPDATED event carrying a refund, on THIS binding's merchant, is
   * handed to `refundUpdated`; every other event — and every event, on a
   * binding with no `confirmations` — is left alone. A throw marks
   * the delivery FAILED, so the provider's redelivery runs it again.
   */
  onWebhookEvent: WebhookEventHandler;
  /**
   * A person's escape for a refund the provider accepted and never confirmed:
   * only past `confirmations.confirmWithinMs`, after one more read of the
   * charge (money back confirms it instead). Reopens it as pending
   * (`NOT_RETURNED`) under a NEW request, with who and why for the host's
   * audit; then retry or settle by hand as usual. Never sends a refund.
   */
  markNotReturned(paymentId: string, byHand: NotReturnedBy): Promise<NotReturnedResult>;
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
  /**
   * Following refunds the provider accepted but did not confirm. Required by
   * `confirmDue`. `confirmWithinMs` is the host's commercial patience: how long
   * a refund may stay unfinished at the provider before a person is asked.
   */
  confirmations?: {
    store(): Promise<RefundConfirmationStore>;
    confirmWithinMs: number;
  };
}

/** What a subscription payment's series is opened under. */
export const SUBSCRIPTION_REFUND_SUBJECT = "subscription-payment";
