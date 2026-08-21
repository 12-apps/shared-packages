/**
 * The billing → gating seam (FUT-132). One function, one table.
 *
 * An entitlements resolver accepts an already-frozen entitlement map plus a
 * coarse lifecycle status, and deliberately never learns what a subscription
 * is. This module is the entire translation in the other direction: it turns
 * one subscription row into that pair, or into `null` when billing has no
 * opinion at all and the resolver should fall back to whatever tier the host
 * assigned by hand.
 *
 * Note what `null` does NOT cover: a cancelled subscription. Once a customer
 * has a billing relationship, billing answers for their tier — including after
 * they end it. Deferring there would read the hand-assigned key, which is stale
 * the moment billing takes over the account and is very often the paid tier
 * they were put on before subscribing, and hand a cancelled customer their paid
 * entitlements back indefinitely. A host that wants to comp them says so in its
 * own override layer, which is the layer that exists for exactly that.
 *
 * Pure — no database, no clock. The caller passes the row and `now`.
 *
 * ## What is config and why
 *
 * Both tables below are the host's, in full:
 *
 * - **which lifecycle each billing state reaches the gate as.** "A past-due
 *   customer is restricted but keeps their tier; a cancelled one becomes a free
 *   account rather than a dark one" is a commercial position, and a different
 *   platform takes a different one — suspend on day one, or never suspend at
 *   all. The package cannot hold an opinion it would be imposing.
 * - **which states keep their FROZEN tier.** Same argument, and the two are
 *   separate because they genuinely vary independently: a state can be
 *   restricted while keeping everything it bought (it is being chased, not
 *   downgraded), and another can stay fully active on a different tier.
 *
 * What the package owns is the part that is nobody's opinion: age the stored
 * status, refuse to guess at an unrecognised one, and read the fallback tier
 * from the LIVE catalog rather than from the frozen snapshot — the snapshot is
 * the tier they stopped paying for.
 */
import { BillingConfigError } from "./errors";
import {
  BILLING_STATUSES,
  isBillingStatus,
  type BillingLifecycle,
  type BillingStatus,
  type SubscriptionTiming,
} from "./status";

/** The subscription columns the seam reads. Structural, so tests need no ORM. */
export interface SubscriptionBillingRow extends SubscriptionTiming {
  status: string;
  planKey: string;
  /** The FROZEN plan layer, exactly as the host's JSON column hands it back. */
  entitlements: unknown;
}

/** What billing contributes to the resolver, when it contributes anything. */
export interface BillingLayer<TPlan, TLifecycle> {
  planKey: string;
  plan: TPlan;
  status: TLifecycle;
  /** The aged billing state behind `status` — for reporting, not gating. */
  billingStatus: BillingStatus;
}

/** The host's two tables, plus the catalog reads the seam needs. */
export interface BillingLayerPolicy<TPlan, TLifecycle> {
  /** The aged view — the same instance the rest of the host reads statuses through. */
  lifecycle: BillingLifecycle;
  /** How each billing state reaches the gate. Every state, no defaults. */
  lifecycleByStatus: Readonly<Record<BillingStatus, TLifecycle>>;
  /** Statuses whose FROZEN snapshot is still what the customer is entitled to. */
  keepsItsTier: Readonly<Record<BillingStatus, boolean>>;
  /**
   * The tier a customer falls back to when theirs is no longer theirs.
   *
   * A function, and read per call, because it must come from the LIVE catalog:
   * resolving it once at construction would pin a process to whatever the
   * catalog said at boot, and the whole reason this is not the row's frozen map
   * is that the frozen map is the tier they stopped paying for.
   */
  defaultTier(): { planKey: string; plan: TPlan };
  /**
   * Narrow the row's frozen JSON into the host's plan shape.
   *
   * The snapshot was written by an older deploy and is untrusted input, so this
   * is the host's own coercion — the same one its live override column gets —
   * rather than a cast here.
   */
  frozenTier(entitlements: unknown): TPlan;
}

function assertCovers(what: string, table: Readonly<Record<string, unknown>>): void {
  const missing = BILLING_STATUSES.filter((status) => !(status in table));
  if (missing.length > 0) {
    throw new BillingConfigError(
      `billingLayer.${what}`,
      `must name every billing status; missing: ${missing.join(", ")}.`,
    );
  }
}

/**
 * Bind the host's tables once, and read a subscription row as an entitlement
 * layer — or `null` when billing has no opinion at all: no subscription, or a
 * status this build does not recognise.
 *
 * An UNRECOGNISED status defers rather than throwing, suspending or
 * downgrading. A row written by a newer deploy — or by hand — must not be able
 * to take a paying customer's account down, and must not be able to grant them
 * anything either; falling back to the host's own assignment is the only
 * reading that does neither.
 */
export function createBillingLayer<TPlan, TLifecycle>(
  policy: BillingLayerPolicy<TPlan, TLifecycle>,
): (row: SubscriptionBillingRow | null, now: Date) => BillingLayer<TPlan, TLifecycle> | null {
  assertCovers("lifecycleByStatus", policy.lifecycleByStatus);
  assertCovers("keepsItsTier", policy.keepsItsTier);

  return function billingLayer(row, now) {
    if (!row || !isBillingStatus(row.status)) return null;

    const billingStatus = policy.lifecycle.effectiveStatus(row.status, row, now);
    const status = policy.lifecycleByStatus[billingStatus];

    if (!policy.keepsItsTier[billingStatus]) {
      const fallback = policy.defaultTier();
      return { planKey: fallback.planKey, plan: fallback.plan, status, billingStatus };
    }

    return {
      planKey: row.planKey,
      plan: policy.frozenTier(row.entitlements),
      status,
      billingStatus,
    };
  };
}
