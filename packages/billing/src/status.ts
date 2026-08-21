/**
 * Subscription lifecycle (FUT-132) — the single place billing states are
 * defined, aged, and made readable to a gate.
 *
 * Pure: no database, no clock of its own (`now` is always a parameter). The
 * MECHANISM is here; every number is the host's.
 *
 * ## Why the windows are config and not constants
 *
 * "How long before we penalise a late payer, and how long before we suspend
 * them" is a commercial decision, not a property of subscriptions — one
 * platform chases for a week and suspends after thirty days, the next gives a
 * fortnight and never suspends at all. A default here would be one platform's
 * collections policy shipped to every other one, arriving silently and reading
 * as finished. So `createBillingLifecycle` REQUIRES both, asserts their
 * relationship, and owns nothing else.
 *
 * ## Why `effectiveStatus` re-derives from dates
 *
 * The stored `status` is maintained by a sweep. A sweep that stops running
 * must not silently hand out free service forever, so every READ ages the row
 * itself and takes the harsher of (stored, implied-by-dates). The sweep then
 * only ever persists what a read would already have concluded — it is a
 * materialization, not the source of truth.
 */
import { BillingConfigError } from "./errors";

/** The states a subscription's status column may hold (mirrors the CHECK). */
export type BillingStatus =
  /** Inside a free trial. Fully entitled; no money has changed hands yet. */
  | "trialing"
  /** Paid and current. */
  | "active"
  /** A cycle went unpaid past its grace window. Soft penalty. */
  | "past_due"
  /** Dunning exhausted. Hard stop. */
  | "unpaid"
  /** Ended by the owner (or by us). No longer entitling anything. */
  | "canceled";

/** Every state, in decay order — the vocabulary a host maps onto its gate. */
export const BILLING_STATUSES: readonly BillingStatus[] = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
];

/** Type guard for a value read out of the database. */
export function isBillingStatus(value: string): value is BillingStatus {
  return (BILLING_STATUSES as readonly string[]).includes(value);
}

const MS_PER_DAY = 86_400_000;

/** The dates `effectiveStatus` ages a subscription against. */
export interface SubscriptionTiming {
  /** End of the cycle currently paid for — also the next charge's due date. */
  currentPeriodEnd: Date;
  /** When dunning started; null while the subscription is current. */
  pastDueSince: Date | null;
}

/** The two windows a platform has to choose for itself. */
export interface BillingLifecyclePolicy {
  /**
   * Days after a cycle's due date before the customer is penalised at all.
   *
   * A card that expired on renewal day is the common case, not fraud: the
   * provider retries, the owner gets an e-mail, and nothing about their account
   * changes in the meantime. Restricting on day zero would punish a failed
   * retry the owner has not even been told about yet.
   */
  graceDays: number;
  /**
   * Days after the SAME due date before the account is suspended outright.
   *
   * Measured from the due date rather than from the start of `past_due` so the
   * two thresholds share an origin and "how long do I have?" has one answer.
   * The window between the two is the dunning period, during which the
   * customer is degraded but fully recoverable, with every row still in place.
   */
  suspendAfterDays: number;
}

/** The aged view of a subscription — what a gate and a report both read. */
export interface BillingLifecycle extends BillingLifecyclePolicy {
  /**
   * The status a subscription ACTUALLY has right now — stored state aged
   * against the clock.
   *
   * `canceled` and `unpaid` are terminal here: nothing but a new payment or a
   * new subscription moves them, and neither is something a read can observe.
   * `trialing` and `active` decay through `past_due` into `unpaid` as their due
   * date recedes; a trial that runs out is exactly a cycle that was not paid,
   * so it needs no separate branch.
   */
  effectiveStatus(stored: BillingStatus, timing: SubscriptionTiming, now: Date): BillingStatus;
  /**
   * How many days this customer has gone without paying — the column an
   * overdue report sorts on.
   *
   * Whole days since the due date, RAW: it counts through the grace window too,
   * because the honest answer to "how long has this account owed us money" does
   * not depend on our collections policy. A report that only wants the ones
   * actually being chased filters `>= graceDays`; one that wants early warning
   * of a failing card does not, and both are served by the same number.
   *
   * 0 while the customer is current.
   */
  daysWithoutPaying(timing: SubscriptionTiming, now: Date): number;
  /** When the grace window closes for the cycle currently due. */
  graceEndsAt(timing: SubscriptionTiming): Date;
  /** When an unpaid cycle turns into a suspension. */
  suspendsAt(timing: SubscriptionTiming): Date;
}

/**
 * The instant the customer stopped being paid up.
 *
 * `pastDueSince` wins when set, because a cycle that fell due, was chased and
 * is still unpaid must not have its clock reset by a renewal that advanced
 * `currentPeriodEnd`. Absent that, the current cycle's end is the due date.
 */
function dueSince(timing: SubscriptionTiming): Date {
  return timing.pastDueSince ?? timing.currentPeriodEnd;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function assertPolicy(policy: BillingLifecyclePolicy): void {
  const { graceDays, suspendAfterDays } = policy;
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new BillingConfigError("lifecycle.graceDays", "must be a whole number of days, zero or more.");
  }
  if (!Number.isInteger(suspendAfterDays) || suspendAfterDays < 0) {
    throw new BillingConfigError(
      "lifecycle.suspendAfterDays",
      "must be a whole number of days, zero or more.",
    );
  }
  // Both are measured from the SAME origin, so a suspension threshold at or
  // below the grace threshold does not merely shorten dunning — it deletes the
  // restricted state entirely, and an account would go from current straight to
  // suspended with nobody having decided that.
  if (suspendAfterDays <= graceDays) {
    throw new BillingConfigError(
      "lifecycle.suspendAfterDays",
      `must be greater than graceDays (${String(graceDays)}) — both count from the due date, so ` +
        "an equal or smaller value leaves no dunning window at all.",
    );
  }
}

/** Bind the two windows once; every read below ages against them. */
export function createBillingLifecycle(policy: BillingLifecyclePolicy): BillingLifecycle {
  assertPolicy(policy);
  const { graceDays, suspendAfterDays } = policy;

  return {
    graceDays,
    suspendAfterDays,

    effectiveStatus(stored, timing, now) {
      if (stored === "canceled" || stored === "unpaid") return stored;

      const overdueDays = daysBetween(dueSince(timing), now);
      if (overdueDays >= suspendAfterDays) return "unpaid";
      if (overdueDays >= graceDays) return "past_due";

      // Inside the grace window a stored `past_due` is NOT downgraded back to
      // active: only a recorded payment clears dunning, and clearing it here
      // would let a renewal that merely moved the period end forgive a debt.
      return stored === "past_due" ? "past_due" : stored;
    },

    daysWithoutPaying(timing, now) {
      return Math.max(0, daysBetween(dueSince(timing), now));
    },

    graceEndsAt(timing) {
      return new Date(dueSince(timing).getTime() + graceDays * MS_PER_DAY);
    },

    suspendsAt(timing) {
      return new Date(dueSince(timing).getTime() + suspendAfterDays * MS_PER_DAY);
    },
  };
}
