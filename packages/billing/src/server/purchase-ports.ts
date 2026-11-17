import {
  attemptReference,
  baseReference,
  type CardCollectionOptions,
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
  purchase: Purchase;
  /** The charge outstanding for the CURRENT attempt, or null when none is. */
  providerChargeId: string | null;
  /**
   * The current attempt's ordinal, from 0. The host persists it and advances
   * it by one in `markFailed`, never anywhere else.
   */
  attempt: number;
}

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
  /** `'unknown'`: no such purchase. `'settled'`: already paid. */
  read(purchaseId: string): Promise<PayablePurchase | "unknown" | "settled">;
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
}

/** The host's purchase rows, built per call over its own database client. */
export type PurchaseStoreFactory = () => Promise<PurchaseStore>;

/** What the purchase flow needs from the host's already-built payments gateway. */
export interface PurchasePayments {
  gateway: Pick<PaymentsGateway, "charge" | "refreshCharge">;
  credentials: Pick<CredentialStore, "defaultProvider">;
}

/**
 * Where a payment that needs a person is reported: a shortfall, an excess, a
 * purchase paid twice, a grant that threw. REQUIRED — a host that wants no
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
   * Deliver what was bought. Called ONCE per purchase, only by the caller
   * whose `claimSettled` won. A throw is logged and rethrown, and the claim
   * stands — a host whose grant must be atomic with the claim grants inside
   * `claimSettled` and passes a no-op here.
   */
  onSettled(purchase: Purchase, settled: PurchaseSettled): Promise<void>;
  logger: PurchaseLog;
  /** The clock, for `paidAt`. Default: `new Date()`. */
  now?: () => Date;
}

/** The input payments-backend's webhook reactor hands `settlePlatformPayment`. */
export interface PlatformChargeInput {
  reference: string;
  amountCents: number;
  providerChargeId: string;
}

/**
 * `settlePlatformCharge`'s answer. Only `"not-mine"` hands the charge back to
 * the host's own cycle settle; every other answer means it was a purchase.
 */
export type PurchaseSettleOutcome =
  | "not-mine"
  /** This call won the claim and `onSettled` ran. */
  | "granted"
  /** Already paid — a replay, a race lost, or a second payment (logged). */
  | "already-settled"
  /** Paid less than owed: refused before claiming, logged, still payable. */
  | "shortfall"
  /** The reference names a purchase the host has no row for (logged). */
  | "unknown";

/** What one `reconcileDue` pass did. */
export interface PurchaseReconcilePass {
  settled: number;
  failed: number;
  stillPending: number;
  /** The provider could not be asked; the charge is read again next pass. */
  unreadable: number;
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
  /** Ask the provider about every unanswered charge: settle paid, fail lapsed or refused. */
  reconcileDue(now?: Date): Promise<PurchaseReconcilePass>;
}
