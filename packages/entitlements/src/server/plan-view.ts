/**
 * The tenant's own view of their plan.
 *
 * Until a screen like this exists, a tenant can only learn what plan they are
 * on by walking into walls: a disabled toggle saying "Não incluído no seu
 * plano" on one screen, an upsell line on another. Nothing says which tier
 * they are on, what else it includes, or what would change if they moved.
 *
 * The two distinctions this view exists to preserve:
 *
 *   1. **"your plan doesn't include this" vs "you switched this off"**. The
 *      first is fixed by upgrading, the second by a toggle they already own.
 *      Collapsing them sells an upgrade that changes nothing.
 *   2. **an upsell only where one would actually help**. `requiredPlan` is null
 *      when no tier grants the feature, and offering "upgrade to fix this"
 *      there is a straightforward lie.
 *
 * Pricing arrives as DISPLAY DATA (`{ key, name, priceCents }` rows the host's
 * billing computed) and is WORDED by a `priceLabel` the host supplies. This
 * module never stores, computes or formats money: it used to ship a BRL
 * formatter as the default, which is a currency — a fact about the host's
 * product, not about entitlements — and every silent host inherited it.
 */
import type { EntitlementDecision } from '../core/types';
import type { TenantFeatureReason, TenantPlanView } from '../plan-wire';
import type { PlanViewMessages } from './copy';

export type { TenantFeatureView, TenantPlanView } from '../plan-wire';

/** A pricing row — display data the host's billing supplies. */
export interface PricingRow {
  key: string;
  name: string;
  priceCents: number;
}

/** A row worth showing a tenant at all. */
function isVisible(decision: EntitlementDecision<string>): boolean {
  return decision.reason !== 'not-supported';
}

/**
 * Live usage for a quota row, plus the tier that would raise its ceiling —
 * measured and resolved by the CALLER (this module stays pure).
 */
export interface QuotaUsageView {
  used: number;
  /** The cheapest tier whose ceiling clears the current one, or null. */
  nextPlan: string | null;
}

/**
 * Is this row a quota the tenant has OUTGROWN — entitled, but holding more
 * than the ceiling (grandfathered rows, or a downgrade)?
 *
 * A distinct state on purpose: the feature IS in their plan, so the
 * `not-entitled` wording would be false, and the `enabled` wording would hide
 * that creates refuse. Only `used > limit` counts — a tenant exactly AT its
 * ceiling is simply full, and says so through `used`/`limit`, not a banner.
 */
function isOverQuota(
  decision: EntitlementDecision<string>,
  usage: QuotaUsageView | undefined,
): usage is QuotaUsageView {
  return (
    decision.enabled &&
    typeof decision.limit === 'number' &&
    usage !== undefined &&
    usage.used > decision.limit
  );
}

/**
 * The over-quota note: everything they have keeps working, only adding MORE
 * needs a bigger plan. The WORDING is the host's (`messages.overQuotaNote`);
 * what this resolves is the upsell clause's label — the COMMERCIAL name of
 * the tier whose ceiling clears what they hold, or null when no tier would,
 * because a wrong upsell is the single most damaging thing this screen could
 * print.
 */
function overQuotaNote(
  limit: number,
  usage: QuotaUsageView,
  pricing: readonly { key: string; name: string }[],
  messages: PlanViewMessages,
): string {
  return messages.overQuotaNote({
    limit,
    used: usage.used,
    nextPlanLabel: labelFor(usage.nextPlan, pricing),
  });
}

/**
 * The tier that would fix this, or `null` when upgrading would not.
 *
 * Only `not-entitled` is a plan problem. A feature the tenant turned off, or
 * one suspended for non-payment, is not fixed by spending more — and the
 * engine already says so by returning `requiredPlan: null` for those. This
 * narrows it further rather than trusting that, because a wrong upsell is the
 * single most damaging thing this screen could print.
 */
function upsellFor(decision: EntitlementDecision<string>): string | null {
  if (decision.reason !== 'not-entitled') return null;
  return decision.requiredPlan;
}

/** A tier's commercial name, falling back to the key rather than to nothing. */
function labelFor(
  planKey: string | null,
  pricing: readonly { key: string; name: string }[],
): string | null {
  if (planKey === null) return null;
  return pricing.find((plan) => plan.key === planKey)?.name ?? planKey;
}

/**
 * Assemble the tenant's view.
 *
 * Pure: it takes decisions the engine already resolved rather than resolving
 * anything itself, so the screen cannot disagree with the gate — and so this
 * can be tested without a database.
 */
export function buildTenantPlanView(
  planKey: string,
  decisions: Readonly<Record<string, EntitlementDecision<string>>>,
  pricing: readonly PricingRow[],
  describe: (feature: string) => string | null,
  /** Live usage per quota feature, when the caller measured it. */
  usage: Readonly<Record<string, QuotaUsageView>>,
  /**
   * How a price in cents reads on the wire.
   *
   * REQUIRED, and the reason this parameter exists at all: it used to default
   * to a BRL formatter that lived in this file, so the package decided the
   * host's currency for it. A number is presentation; WHOSE money it is, is
   * not this package's to say.
   */
  priceLabel: (priceCents: number | null) => string | null,
  /**
   * The situation notes — REQUIRED, the host's words (pt-BR hosts:
   * `PT_BR_ENTITLEMENTS_MESSAGES` from `./pt-BR`). `featureNotes` has no
   * `not-supported` key on purpose: a feature this build has never heard of
   * is not something a tenant can buy, fix, or act on, so those rows are
   * dropped entirely rather than worded.
   */
  messages: PlanViewMessages,
): TenantPlanView {
  const priced = pricing.find((plan) => plan.key === planKey) ?? null;

  const features = Object.values(decisions)
    .filter(isVisible)
    .map((decision) => {
      const quota = usage[decision.feature];
      // Over-quota is the one state where the upsell hangs off an ENABLED row:
      // the plan includes the feature, the tenant outgrew the ceiling, and the
      // honest remedy is the tier that raises it.
      const over = isOverQuota(decision, quota);
      const requiredPlan = over ? quota.nextPlan : upsellFor(decision);
      const reason = decision.reason as TenantFeatureReason;
      return {
        feature: decision.feature,
        description: describe(decision.feature),
        enabled: decision.enabled,
        reason,
        note:
          over && typeof decision.limit === 'number'
            ? overQuotaNote(decision.limit, quota, pricing, messages)
            : messages.featureNotes[reason],
        limit: decision.limit,
        used: quota?.used ?? null,
        requiredPlan,
        requiredPlanLabel: labelFor(requiredPlan, pricing),
      };
    })
    // What they HAVE first, then what they do not — a tenant reading this
    // wants "here is your plan", not a list of denials with the good news
    // buried.
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.feature.localeCompare(b.feature);
    });

  const priceCents = priced?.priceCents ?? null;
  return {
    planKey,
    name: priced?.name ?? planKey,
    priceCents,
    price: priceLabel(priceCents),
    features,
  };
}

