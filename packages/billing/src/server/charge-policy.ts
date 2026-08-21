import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  classifyFailure,
  type ChargeSnapshot,
  declineForbidsRetry,
  declineMeansInstrumentDead,
} from "@12-apps/payments-backend";

import { BillingConfigError } from "../errors";

/**
 * WHETHER to try collecting again, and when (FUT-340).
 *
 * Pure — no I/O, no clock, no database. That is deliberate: this is the part
 * of subscription billing where being wrong costs real money in a direction
 * nobody notices for weeks, and a function that only maps a failure onto a
 * decision can be exhaustively tested against the taxonomy it claims to
 * implement.
 *
 * ## The three questions, in order
 *
 * 1. **Did it become a charge?** `classifyFailure()` already answers this and
 *    is the only thing standing between a retry and a double bill. AMBIGUOUS
 *    never retries here — by the time the gateway raises
 *    `AmbiguousChargeError` it has already probed and failed to settle the
 *    question, so a retry would be exactly the blind one the whole failover
 *    design exists to prevent. It is a support ticket, not a backoff.
 *
 * 2. **Did the provider say no?** Then the reason decides, against the host's
 *    own `stopWithoutNewCard` list — see that field.
 *
 * 3. **Is another attempt possible at all?** A provider that says the card is
 *    finished — stolen, revoked, a cancelled recurring mandate — is telling us
 *    the instrument is dead, not that the moment was bad. Retrying is not
 *    merely futile there: continuing to present a revoked recurring debit is
 *    how chargebacks are earned.
 *
 * ## What this package refuses to decide
 *
 * The ladder, the attempt cap and which declines are worth chasing rather than
 * retrying are COMMERCIAL policy. `@12-apps/payments-backend` says so by name
 * — "retry ladders, grace windows, when to ask for a different card, is each
 * host's commercial policy and deliberately NOT modelled here" — and the same
 * boundary holds one layer up: this module is the three questions, not the
 * answers. Every number arrives through {@link createChargePolicy}, required,
 * with no defaults to fall back to silently.
 *
 * Server-safe and client-safe (nothing here touches either).
 */

/** What the job does next. */
export type ChargeDecision =
  /**
   * Nothing left to do, and nothing to tell anyone. The charge exists (paid,
   * or pending at the provider and settling by webhook), or the cycle was
   * already handled.
   *
   * Distinct from STOP, and the distinction is load-bearing: STOP means "we
   * gave up", which sends the customer a failure notice. Collapsing the two
   * would e-mail "we could not charge your card" to every customer we just
   * successfully charged.
   */
  | { kind: "DONE" }
  /** Try again after `delayMs`. The cycle stays open and nobody is told yet. */
  | { kind: "RETRY"; delayMs: number }
  /**
   * Stop attempting this cycle. Whether the row is left open for the dunning
   * ladder is the host's call; the decision only says this timer is finished
   * and whether the customer must supply a different instrument.
   */
  | { kind: "STOP"; needsNewCard: boolean }
  /**
   * The charge's fate is genuinely unknown and a human has to reconcile it.
   * Distinct from STOP because retrying or re-charging here is what produces
   * the double bill. The attempt STAYS spent — a provider that may be holding
   * the money must not be asked again on a timer.
   */
  | { kind: "ALERT" }
  /**
   * Nothing was attempted, and the reason is ours: the deployment cannot
   * collect at all. The attempt is GIVEN BACK.
   *
   * Distinct from ALERT precisely because of that refund, and the distinction
   * is not academic. A tick that enqueues every open cycle would spend a
   * customer's whole budget inside a few hours discovering a missing platform
   * account — and by the time an operator fixed the credentials, every cycle
   * would be permanently unchargeable. A budget exists to bound how often we
   * bother an ISSUER; nobody was bothered here.
   */
  | { kind: "ABORT" };

/** The commercial half — every value a platform must decide for itself. */
export interface ChargeRetryPolicy {
  /**
   * How many collection attempts one cycle may spend, across every re-enqueue.
   *
   * Counted on the host's own cycle row rather than in a queue, because a
   * queue's counter dies with the job while the cycle outlives it: the next
   * tick re-enqueues the same cycle, the runtime calls that attempt one, and a
   * card that declines every hour would be presented to the issuer forever.
   */
  maxAttempts: number;
  /**
   * The wait before attempt N+1, indexed by attempts already spent. The last
   * entry repeats if the cap ever grows past the ladder.
   *
   * A literal ladder and not a formula: `2 ** n * base` is shorter and
   * unreadable at the only moment it matters — when someone is working out why
   * a customer was charged four times in a night. The array IS the schedule,
   * and its total span is the number that actually needs review.
   */
  backoffMs: readonly number[];
  /**
   * Decline reasons that end the cycle but do NOT ask for a different card.
   *
   * The list with real money behind it. A no-funds decline is the canonical
   * member: presenting a card that had no funds an hour ago burns the attempt
   * budget and, on some acquirers, counts against the merchant's own standing —
   * and the holder's card is fine, so demanding a new one is both wrong and
   * insulting. The dunning ladder chases that customer; a retry is worth making
   * only when they act.
   *
   * Note this OVERRIDES the provider's own verdict, which is the point: an
   * acquirer may mark no-funds retriable and be right at its grain — the holder
   * may top up — but that is an argument for chasing them, not for a timer.
   */
  stopWithoutNewCard: readonly string[];
}

/** The bound policy: the three questions, answered against one host's numbers. */
export interface ChargePolicy {
  /** Echoed back so a host's row guard and its policy cannot disagree. */
  readonly maxAttempts: number;
  /**
   * What to do after a provider REFUSED the charge — a decline that arrived as
   * a snapshot rather than a throw, which is the house rule every adapter
   * follows.
   */
  decideAfterDecline(
    snapshot: Pick<ChargeSnapshot, "declineReason" | "declineRetriable">,
    attempts: number,
  ): ChargeDecision;
  /**
   * What to do after the charge attempt THREW.
   *
   * The classification comes from the payments package rather than from a
   * second copy here, so "is this safe to retry" has exactly one answer.
   */
  decideAfterError(error: unknown, attempts: number): ChargeDecision;
}

function assertPolicy(policy: ChargeRetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new BillingConfigError("chargePolicy.maxAttempts", "must be a whole number of at least 1.");
  }
  if (policy.backoffMs.length === 0) {
    throw new BillingConfigError(
      "chargePolicy.backoffMs",
      "must name at least one wait — an empty ladder would retry immediately, forever.",
    );
  }
  for (const delay of policy.backoffMs) {
    if (!Number.isFinite(delay) || delay <= 0) {
      throw new BillingConfigError(
        "chargePolicy.backoffMs",
        `every wait must be a positive number of milliseconds, got ${String(delay)}.`,
      );
    }
  }
}

export function createChargePolicy(policy: ChargeRetryPolicy): ChargePolicy {
  assertPolicy(policy);
  const { maxAttempts, backoffMs } = policy;
  const stopWithoutNewCard = new Set(policy.stopWithoutNewCard);

  /** The wait before the next attempt, given how many have been spent. */
  function backoffAfter(attempts: number): number {
    const last = backoffMs[backoffMs.length - 1] ?? 0;
    return backoffMs[attempts - 1] ?? last;
  }

  /**
   * Retry unless the budget is spent. `attempts` is the count INCLUDING the
   * one that just failed, so the comparison is against the cap directly.
   */
  function retryOrStop(attempts: number, needsNewCard = false): ChargeDecision {
    if (attempts >= maxAttempts) return { kind: "STOP", needsNewCard };
    return { kind: "RETRY", delayMs: backoffAfter(attempts) };
  }

  function decideAfterDecline(
    snapshot: Pick<ChargeSnapshot, "declineReason" | "declineRetriable">,
    attempts: number,
  ): ChargeDecision {
    const reason = snapshot.declineReason ?? "UNKNOWN";

    // The host's list wins over everything below it, including the provider's
    // own retriable flag — see `stopWithoutNewCard`.
    if (stopWithoutNewCard.has(reason)) return { kind: "STOP", needsNewCard: false };

    // The card is finished — a taxonomy property, answered by the payments
    // package (FUT-761). Asking for a different one is the only move.
    if (declineMeansInstrumentDead(reason)) return { kind: "STOP", needsNewCard: true };

    // The provider explicitly said not to try this card again. It reaches here
    // for the declines the reason taxonomy cannot express as terminal — a
    // cancelled recurring mandate, an exhausted attempt limit — and treating it
    // as a soft decline is what keeps presenting a debit the holder revoked.
    if (declineForbidsRetry(snapshot)) return { kind: "STOP", needsNewCard: true };

    return retryOrStop(attempts);
  }

  return {
    maxAttempts,
    decideAfterDecline,
    decideAfterError(error, attempts) {
      // Already probed by the gateway and still unresolved. Retrying is the
      // double charge; a human reconciles it.
      if (error instanceof AmbiguousChargeError) return { kind: "ALERT" };

      // A decline that came as an exception rather than a snapshot. Same policy
      // — it carries the same normalized reason now that the walk preserves it.
      if (error instanceof ChargeDeclinedError) {
        return decideAfterDecline({ declineReason: error.reason }, attempts);
      }

      if (classifyFailure(error) === "AMBIGUOUS") return { kind: "ALERT" };

      // Provably never became a charge: a validation error, a refused
      // connection, a credential rejection. Safe to try again, and often worth
      // it — a rejected credential is usually an operator fixing a key while
      // the ladder waits.
      return retryOrStop(attempts);
    },
  };
}
