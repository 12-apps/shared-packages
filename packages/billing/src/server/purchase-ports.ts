import {
  attemptReference,
  baseReference,
  type CardCollectionOptions,
  type ChargeStore,
  type CollectionResult,
  type CredentialStore,
  type CustomerInfo,
  type DeclineReason,
  type MerchantRef,
  type Money,
  type PaymentsGateway,
  type ProviderName,
} from "@12-apps/payments-backend";

import type { InstrumentLookup } from "./ports";

/**
 * The seams of a ONE-OFF PURCHASE (FUT-5094) — something a customer buys from
 * the platform once and pays IN ADVANCE, outside any subscription cycle.
 *
 * Declared in one file for the reason `./ports` is: an adopting host reads the
 * whole obligation in one screen. The flow itself is in `./purchase`.
 */

/**
 * What every purchase charge's provider reference starts with — owned by this
 * package, so dispatching a platform settlement is the package's decision, not
 * a guess the host makes about an id's shape.
 *
 * A colon, because no row id a host mints (a uuid, a cuid, a serial) carries
 * one: a subscription cycle's reference is its bare id and can never start with
 * this. Never change it — every purchase charge on disk is written with it.
 */
export const PURCHASE_REFERENCE_PREFIX = "purchase:";

/**
 * The provider reference — and idempotency key — of ONE attempt at paying a
 * purchase. Attempt 0 is the bare `purchase:<id>`; a later attempt carries the
 * payments package's own `--<n>` suffix, so a retry after a failed card or a
 * lapsed code is a FRESH charge rather than the provider's answer to the old
 * key.
 */
export function purchaseReference(purchaseId: string, attempt: number): string {
  return attemptReference(`${PURCHASE_REFERENCE_PREFIX}${purchaseId}`, attempt);
}

/**
 * The purchase a platform charge's reference names, or null when it names
 * none (a subscription cycle's reference, or a malformed one).
 */
export function purchaseIdOf(reference: string): string | null {
  if (!reference.startsWith(PURCHASE_REFERENCE_PREFIX)) return null;
  const id = baseReference(reference).slice(PURCHASE_REFERENCE_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** One purchase, reduced to what charging it needs to know. */
export interface Purchase {
  /** The host's row id. Must not contain `--`, the attempt separator. */
  id: string;
  /** Whose card pays it — the key the host's `instruments` lookup takes. */
  groupId: string;
  /** What is owed, paid in advance. A settlement below it is refused. */
  amount: Money;
  /** The customer as the provider must see them. */
  customer: CustomerInfo;
}

/** A purchase that can still be paid, as `read` answers it. */
export interface PayablePurchase {
  state: "payable";
  purchase: Purchase;
  /** The charge outstanding for the CURRENT attempt, or null when none is. */
  providerChargeId: string | null;
  /** Who holds that charge — what a settle by ANOTHER attempt's charge voids. */
  provider: ProviderName | null;
  /**
   * The current attempt's ordinal, from 0. The host persists it and advances
   * it by one in `markFailed`, never anywhere else.
   */
  attempt: number;
}

/** A purchase already paid, as `read` and `undelivered` answer it. */
export interface SettledPurchase {
  state: "settled";
  purchase: Purchase;
  /** What `claimSettled` recorded — above all WHICH charge settled it. */
  settlement: PurchaseSettlement;
  /** Whether `markDelivered` has been written since. */
  delivered: boolean;
}

/** One purchase row, as `read` answers it. */
export type PurchaseRow = PayablePurchase | SettledPurchase;

/** What `recordRaised` is told: the charge now outstanding for one attempt. */
export interface RaisedPurchaseCharge {
  attempt: number;
  /** The provider reference this attempt was raised under. */
  reference: string;
  provider: ProviderName;
  providerChargeId: string;
  method: "PIX" | "CARD";
  /** When a push code stops being payable, when the provider said. */
  expiresAt: Date | null;
}

/** What `claimSettled` is told: the confirmed payment that settles a purchase. */
export interface PurchaseSettlement {
  /** What the provider says it CAPTURED — never below the amount owed. */
  amountCents: number;
  /** The purchase's own currency, which the payment was checked against. */
  currency: string;
  providerChargeId: string;
  paidAt: Date;
}

/** Why an attempt failed; what `markFailed` is told. */
export interface PurchaseFailure {
  /** The attempt that failed — the condition `markFailed` writes under. */
  attempt: number;
  providerChargeId: string | null;
  /** DECLINED: a card refused. EXPIRED: a push code lapsed unpaid. CANCELED: voided at the provider. */
  reason: "DECLINED" | "EXPIRED" | "CANCELED";
  declineReason?: DeclineReason;
}

/** An attempt with a charge outstanding and no answer yet — what the sweep reads. */
export interface UnansweredPurchaseCharge {
  purchaseId: string;
  attempt: number;
  provider: ProviderName;
  providerChargeId: string;
  /** As recorded by `recordRaised`; the provider's fresher word wins. */
  expiresAt: Date | null;
}

/**
 * The host's purchase rows. Every write is CONDITIONAL, and that is the whole
 * exactly-once argument: a webhook, its replay and the sweep race routinely.
 */
export interface PurchaseStore {
  /** `'unknown'`: no such purchase. */
  read(purchaseId: string): Promise<PurchaseRow | "unknown">;
  /** Stamp the charge outstanding for an attempt. Without it the next start raises a second. */
  recordRaised(purchaseId: string, charge: RaisedPurchaseCharge): Promise<void>;
  /**
   * Move the row to paid — from pending OR failed, since a lapsed code paid
   * late is still money received — and answer true only for the ONE caller
   * whose write moved it. False when it was already paid.
   */
  claimSettled(purchaseId: string, settlement: PurchaseSettlement): Promise<boolean>;
  /**
   * Record a failed attempt: clear the outstanding charge and advance
   * `attempt` by one — ONLY while the row is unpaid and its attempt is still
   * `failure.attempt`. True when this call wrote it.
   */
  markFailed(purchaseId: string, failure: PurchaseFailure): Promise<boolean>;
  /** Every unpaid purchase whose current attempt has a charge outstanding. */
  unanswered(): Promise<readonly UnansweredPurchaseCharge[]>;
  /** Record that `onSettled` returned for this purchase. Idempotent. */
  markDelivered(purchaseId: string): Promise<void>;
  /** Every settled purchase not yet `markDelivered` — what the sweep delivers again. */
  undelivered(): Promise<readonly SettledPurchase[]>;
}

/** The host's purchase rows, built per call over its own database client. */
export type PurchaseStoreFactory = () => Promise<PurchaseStore>;

/** What the purchase flow needs from the host's already-built payments gateway. */
export interface PurchasePayments {
  gateway: Pick<PaymentsGateway, "charge" | "refreshCharge" | "cancelCharge">;
  credentials: Pick<CredentialStore, "defaultProvider">;
}

/**
 * Where a payment that needs a person is reported: a shortfall, a currency
 * mismatch, an excess, a purchase paid twice, a delivery that threw. REQUIRED — a host that wants no
 * output passes no-ops and has said so.
 */
export interface PurchaseLog {
  warn(message: string): void;
  error(message: string): void;
}

/** What `onSettled` is told besides the purchase itself. */
export interface PurchaseSettled extends PurchaseSettlement {
  /** Paid past what was owed (0 when exact). The grant is the purchase, never more. */
  excessCents: number;
}

export interface OneOffPurchaseDeps {
  /** The host's payments gateway, resolved per call — see `BillingPlatformDeps.payments`. */
  payments(): Promise<PurchasePayments>;
  /** The PLATFORM's merchant; purchases are paid to the platform, as cycles are. */
  merchant: MerchantRef;
  /** Whether this deployment can collect at all. Checked first. */
  enabled(): Promise<boolean>;
  /** Which instrument a `groupId` can be charged with, at one provider. */
  instruments: InstrumentLookup;
  purchases: PurchaseStoreFactory;
  /**
   * Deliver what was bought. ⚠️ MUST BE IDEMPOTENT BY PURCHASE ID: delivery is
   * AT-LEAST-ONCE. It runs first for the caller whose `claimSettled` won; a
   * throw is logged, never rethrown, and `reconcileDue` calls it again for
   * every `undelivered()` row until it returns (and `markDelivered` lands) —
   * so it can run again after a success whose `markDelivered` threw, or
   * while a slow first call is still in flight.
   */
  onSettled(purchase: Purchase, settled: PurchaseSettled): Promise<void>;
  /**
   * A purchase already settled by one charge was paid AGAIN by another (an
   * older attempt's code paid late, say). Nothing is delivered for it; this
   * is where the host refunds or alerts. Called on every confirmation of that
   * charge, so it must be idempotent by `providerChargeId`; a throw is logged
   * and the outcome stands. Optional: absent, the error log is the only trace.
   */
  onDuplicatePayment?(purchase: Purchase, payment: { amountCents: number; providerChargeId: string }): Promise<void>;
  /**
   * The gateway's charge rows, read by idempotency key (a purchase charge's
   * key IS its reference) for the currency a webhook settlement does not
   * carry. The same store the host built its gateway over.
   */
  charges: Pick<ChargeStore, "findByIdempotencyKey">;
  logger: PurchaseLog;
  /** The clock, for `paidAt`. Default: `new Date()`. */
  now?: () => Date;
}

/** The input payments-backend's webhook reactor hands `settlePlatformPayment`. */
export interface PlatformChargeInput {
  reference: string;
  amountCents: number;
  providerChargeId: string;
  /** Absent from the reactor's input; then read from the stored charge (`charges`), and with none the charge is refused. */
  currency?: string;
}

/**
 * `settlePlatformCharge`'s answer. Only `"not-mine"` hands the charge back to
 * the host's own cycle settle; every other answer means it was a purchase.
 */
export type PurchaseSettleOutcome =
  | "not-mine"
  /** This call won the claim and `onSettled` returned. */
  | "granted"
  /** This call won the claim; `onSettled` threw (logged) and the sweep delivers. */
  | "delivery-pending"
  /** Already paid by THIS charge — a replay, or a race lost. */
  | "already-settled"
  /** Already paid by ANOTHER charge: logged, `onDuplicatePayment`, nothing delivered. */
  | "duplicate-payment"
  /** Paid less than owed: refused before claiming, logged, still payable. */
  | "shortfall"
  /** Paid in another currency than owed: refused like a shortfall. */
  | "currency-mismatch"
  /**
   * A purchase charge with no input currency and no stored charge under its
   * reference: its currency cannot be checked, so it is refused (logged at
   * error) and left to `reconcileDue`, which reads the provider's currency.
   */
  | "unrecognised-charge"
  /** The reference names a purchase the host has no row for (logged). */
  | "unknown";

/** What one `reconcileDue` pass did. */
export interface PurchaseReconcilePass {
  settled: number;
  failed: number;
  stillPending: number;
  /** The provider could not be asked; the charge is read again next pass. */
  unreadable: number;
  /** Settled purchases whose `onSettled` returned on this pass. */
  delivered: number;
  /** Settled purchases whose `onSettled` threw again; retried next pass. */
  undelivered: number;
}

/** How `startByCard` charges: the cardholder may be present; one payment, never split. */
export type PurchaseCardOptions = Pick<CardCollectionOptions, "cardholderPresent">;

export interface OneOffPurchase {
  /** Raise a code the customer pays themselves. Settles by webhook or the sweep. */
  startByPush(purchaseId: string): Promise<CollectionResult>;
  /** Charge the card on file. A decline fails the attempt; a PAID answer settles at once. */
  startByCard(purchaseId: string, options?: PurchaseCardOptions): Promise<CollectionResult>;
  /** The host's `settlePlatformPayment` calls this FIRST; `"not-mine"` falls through. */
  settlePlatformCharge(input: PlatformChargeInput): Promise<PurchaseSettleOutcome>;
  /** Ask the provider about every unanswered charge (settle paid, fail lapsed, refused or refunded), then deliver every undelivered purchase. */
  reconcileDue(now?: Date): Promise<PurchaseReconcilePass>;
}
