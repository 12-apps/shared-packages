/**
 * What each tier would cost a tenant that is already using the product — the
 * evidence for a grandfathering decision.
 *
 * ## Where the ceilings come from
 *
 * Every ceiling is DERIVED from the shipped catalog: `surfaces` names the
 * feature key that gates each measured surface, and `toLimit` applies the
 * engine's own normalization (`false` → 0, `true`/`"unlimited"` → Infinity).
 * A hand-written transcription of the tier doc would drift; a catalog change
 * moves this report the same day it moves the gate, with no copy to rot.
 *
 * Deliberately CATALOG-ONLY: no overrides, no tenant settings, no lifecycle
 * status. This module answers "which raw tier fits this usage" — the input to
 * choosing a tier. Whether enforcing a tier is SAFE for a specific tenant is a
 * different question, answered through the real four-layer resolver by
 * `plan-diff.ts`. Swapping resolved decisions in here would silently change
 * the headline for every tenant carrying an override.
 *
 * The SURFACES are host config (which tables the host counts, what the labels
 * say); the arithmetic and the report semantics are the package's.
 */
import { toLimit } from '../core/quota';
import type { PlanCatalog } from '../core/types';
import {
  resolveEntitlementsCopy,
  type EntitlementsCopySource,
  type PlanImpactMessages,
} from './copy';

/** One measured surface: the feature key that gates it, and its report label. */
export interface ImpactSurface<F extends string> {
  feature: F;
  /** The label the report prints — the host's own noun for what it counts. */
  label: string;
}

/** One surface a tenant would lose, or be capped on, at a given tier. */
export interface Violation<S extends string = string> {
  surface: S;
  label: string;
  used: number;
  allowed: number;
  /**
   * `lost` — the tier grants none of this, so the surface disappears entirely.
   * `capped` — they keep what they have (downgrade never deletes) but cannot
   * add another. The distinction decides whether a tenant needs an override or
   * merely a conversation.
   */
  kind: 'lost' | 'capped';
}

/**
 * The minimum a tenant row must carry to be summarized. Structural on purpose:
 * a host repository's own row type satisfies it, and this module stays free of
 * any storage-adjacent import so it can be unit-tested on its own.
 */
export interface SummarizableTenant<K extends string = string> {
  currentPlanKey: string;
  /**
   * Where `currentPlanKey` came from, which decides what an OFF-LADDER key
   * means — the two origins are not interchangeable:
   *
   * - `assigned`: hand-assigned (nothing external had an opinion). The
   *   resolver drops an unrecognised key to the default plan's ceiling.
   * - `snapshot`: an external writer supplied it and the tenant's real
   *   ceilings are that writer's FROZEN entitlement snapshot. An unrecognised
   *   key here is not the default and not any tier — it is unmodellable by
   *   the catalog, so it is reported rather than scored.
   */
  planKeyFrom: 'assigned' | 'snapshot';
  recommendedTier: K | null;
  impactByTier: Record<K, readonly unknown[]>;
}

/** Fleet-level counts for the report footer. */
export interface ImpactSummary {
  total: number;
  /** How many tenants each tier is the cheapest safe home for. */
  byRecommended: Record<string, number>;
  /** Where the fleet ACTUALLY is right now, resolved tier by resolved tier. */
  byCurrent: Record<string, number>;
  /** Tenants that would lose something on the tier they are on TODAY. */
  losingOnCurrent: number;
  /**
   * Tenants whose current key is outside the ladder, and which were therefore
   * scored against the default plan — the tier the resolver actually drops
   * them to. Surfaced rather than hidden: the headline is only trustworthy if
   * you can see how much of it rests on a fallback.
   */
  offLadder: number;
  /**
   * Tenants the catalog CANNOT score: an off-ladder key backed by a live
   * subscription, whose ceilings are that row's frozen entitlement snapshot.
   * Excluded from `losingOnCurrent` in either direction — calling them free
   * would invent losses their subscription still covers; calling them safe
   * would hide real ones.
   */
  unscorable: number;
}

/** The impact calculator, bound to one plan catalog and one surface map. */
export interface PlanImpact<S extends string, K extends string> {
  /** Every surface `usage` exceeds on `tier`, worst first. */
  impactOf(usage: Record<S, number>, tier: K): Violation<S>[];
  /**
   * The cheapest tier that costs this tenant nothing, or `null` if even the
   * top tier would cap them. Walks the catalog's declaration order — the same
   * order `cheapestWith` answers upsell CTAs from, so the two never disagree.
   */
  cheapestTierFor(usage: Record<S, number>): K | null;
  /** Zero usage — the baseline a brand-new tenant sits at. */
  emptyUsage(): Record<S, number>;
  summarizeImpact(report: readonly SummarizableTenant<K>[]): ImpactSummary;
  /**
   * The caveat line for a fleet containing off-ladder keys, or `null` when
   * there are none. Lives here rather than in a CLI because it is a claim
   * about how the headline was computed, and claims need tests.
   */
  formatOffLadderNote(offLadder: number, total: number, locale?: string): string | null;
  /**
   * The line for tenants the catalog cannot score at all — not "measured
   * against a fallback" but "not measured", which is a gap in the evidence
   * rather than a caveat on it.
   */
  formatUnscorableNote(unscorable: number, total: number, locale?: string): string | null;
  /**
   * Render a tier -> count map for the report footer: the ladder in price
   * order, then EVERYTHING ELSE flagged — a tenant on a tier the ladder no
   * longer has is itself something the decision needs to see, and dropping it
   * silently would make the distribution stop summing to the fleet total.
   */
  formatTierBreakdown(counts: Record<string, number>, locale?: string): string;
}

export interface PlanImpactConfig<F extends string, S extends string, K extends string> {
  plans: PlanCatalog<F, K>;
  /** The tier a tenant with no recognisable key resolves to. */
  defaultPlanKey: K;
  /** Every measured surface: the gating feature key and the printed label. */
  surfaces: Record<S, ImpactSurface<F>>;
  /**
   * The report's sentences — REQUIRED, the host's words (pt-BR hosts:
   * `PT_BR_ENTITLEMENTS_MESSAGES`, which satisfies the slice). What stays
   * here is WHEN a note exists and how the breakdown is ordered; what a
   * caveat says about the operator's fleet is copy.
   *
   * A host serving more than one language passes a RESOLVER instead — the
   * shape `@12-apps/i18n`'s `localeCopy(PACK)` returns — and each formatter
   * then chooses per call, from the `locale` its caller passes. Passing a
   * plain value is unchanged in every respect.
   */
  messages: EntitlementsCopySource<PlanImpactMessages>;
}

/** Type guard over the catalog's own key list. */
function planKeyGuard<F extends string, K extends string>(
  plans: PlanCatalog<F, K>,
): (value: string) => value is K {
  return (value): value is K => (plans.list as readonly string[]).includes(value);
}

function summarize<K extends string>(
  report: readonly SummarizableTenant<K>[],
  isPlanKey: (value: string) => value is K,
  defaultPlanKey: K,
): ImpactSummary {
  const byRecommended: Record<string, number> = {};
  const byCurrent: Record<string, number> = {};
  let losingOnCurrent = 0;
  let offLadder = 0;
  let unscorable = 0;

  for (const tenant of report) {
    const recommended = tenant.recommendedTier ?? 'none';
    byRecommended[recommended] = (byRecommended[recommended] ?? 0) + 1;
    byCurrent[tenant.currentPlanKey] = (byCurrent[tenant.currentPlanKey] ?? 0) + 1;

    // Three cases, because an off-ladder key means two different things.
    // Reading "the ladder has no such tier" as "loses nothing" drops a
    // `legacy` tenant blowing through every ceiling from the one number the
    // grandfathering decision turns on — but the opposite blanket rule is
    // just as wrong: a live subscription on a retired key still holds its
    // frozen entitlements, and scoring it against the default would invent
    // losses it covers.
    const key = tenant.currentPlanKey;
    if (isPlanKey(key)) {
      if (tenant.impactByTier[key].length > 0) losingOnCurrent += 1;
    } else if (tenant.planKeyFrom === 'assigned') {
      offLadder += 1;
      if (tenant.impactByTier[defaultPlanKey].length > 0) losingOnCurrent += 1;
    } else {
      unscorable += 1;
    }
  }

  return { total: report.length, byRecommended, byCurrent, losingOnCurrent, offLadder, unscorable };
}

function formatters<F extends string, K extends string>(
  plans: PlanCatalog<F, K>,
  defaultPlanKey: K,
  isPlanKey: (value: string) => value is K,
  source: EntitlementsCopySource<PlanImpactMessages>,
): Pick<PlanImpact<string, K>, 'formatOffLadderNote' | 'formatUnscorableNote' | 'formatTierBreakdown'> {
  // Resolved INSIDE each formatter, never here. `createPlanImpact` runs once
  // per process, so a `const messages` on this line would answer every reader
  // in whichever language the process started with — and a single-locale host
  // could never tell, which is what makes that mistake survive review.
  const copy = (locale?: string): PlanImpactMessages =>
    resolveEntitlementsCopy(source, locale);
  return {
    // Whether a note exists is the package's (zero means no caveat); the
    // sentence is the host's, and it never names WHAT a tenant is — the
    // compiled-in copy once carried one host's own word for its customers.
    formatOffLadderNote(offLadder, total, locale) {
      if (offLadder <= 0) return null;
      return copy(locale).offLadderNote({ offLadder, total, defaultPlanKey });
    },
    formatUnscorableNote(unscorable, total, locale) {
      if (unscorable <= 0) return null;
      return copy(locale).unscorableNote({ unscorable, total });
    },
    formatTierBreakdown(counts, locale) {
      const messages = copy(locale);
      const known = plans.list
        .filter((tier) => (counts[tier] ?? 0) > 0)
        .map((tier) => `${tier} ${counts[tier]}`);
      // "no tier fits" is spelled against the ladder's OWN top tier, read off
      // `plans.list`. It was hardcoded to one host's tier name, so every other
      // adopter's report claimed its heaviest tenants were above a tier that
      // does not exist in their catalog.
      const richest = plans.list[plans.list.length - 1] ?? '?';
      const unknown = Object.keys(counts)
        .filter((key) => !isPlanKey(key) && (counts[key] ?? 0) > 0)
        .sort()
        .map((key) =>
          key === 'none'
            ? messages.tierBreakdownAboveTop({ topTier: richest, count: counts[key] ?? 0 })
            : messages.tierBreakdownOffLadder({ tier: key, count: counts[key] ?? 0 }),
        );
      return [...known, ...unknown].join(', ');
    },
  };
}

/**
 * Refuse a report that would be vacuously reassuring.
 *
 * With NO surfaces, `impactOf` returns `[]` for every tier, so
 * `cheapestTierFor` answers the CHEAPEST tier for every tenant and
 * `losingOnCurrent` is zero across the fleet — the report says "nobody loses
 * anything, move everyone down" about a fleet it never measured. An empty map
 * is far more often a config object assembled from the wrong source than a
 * deliberate "measure nothing", so it is refused rather than believed.
 */
function assertPlanImpactConfig<F extends string, S extends string, K extends string>(
  config: PlanImpactConfig<F, S, K>,
): void {
  if (config.plans.list.length === 0) {
    throw new Error('createPlanImpact: `plans` is an empty ladder — there is no tier to score against.');
  }
  if (Object.keys(config.surfaces).length === 0) {
    throw new Error(
      'createPlanImpact: `surfaces` is empty. Every tenant would then be reported as ' +
        'losing nothing on the cheapest tier, which is a verdict about a fleet that was ' +
        'never measured. Name the surfaces to measure.',
    );
  }
  if (!(config.plans.list as readonly string[]).includes(config.defaultPlanKey)) {
    throw new Error(
      `createPlanImpact: \`defaultPlanKey\` is "${config.defaultPlanKey}", which the ladder ` +
        'does not declare. Off-ladder tenants are scored against it, so it has to be a real tier.',
    );
  }
}

export function createPlanImpact<F extends string, S extends string, K extends string>(
  config: PlanImpactConfig<F, S, K>,
): PlanImpact<S, K> {
  assertPlanImpactConfig(config);
  const { plans, defaultPlanKey, surfaces } = config;
  const surfaceKeys = Object.keys(surfaces) as S[];
  const isPlanKey = planKeyGuard(plans);

  function impactOf(usage: Record<S, number>, tier: K): Violation<S>[] {
    const entitlements = plans.get(tier).entitlements;
    const violations: Violation<S>[] = [];
    for (const surface of surfaceKeys) {
      const used = usage[surface];
      // `toLimit` is the gate's own normalization: `false` → 0 (not entitled
      // at all), `true` and `"unlimited"` → Infinity. Zero is a real ceiling.
      const allowed = toLimit(entitlements[surfaces[surface].feature]);
      if (used <= allowed) continue;
      violations.push({
        surface,
        label: surfaces[surface].label,
        used,
        allowed,
        kind: allowed === 0 ? 'lost' : 'capped',
      });
    }
    // A surface that vanishes outranks one that merely stops growing; within a
    // kind, the bigger overage is the bigger conversation.
    return violations.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'lost' ? -1 : 1;
      return b.used - a.used;
    });
  }

  return {
    impactOf,
    cheapestTierFor(usage) {
      return plans.list.find((tier) => impactOf(usage, tier).length === 0) ?? null;
    },
    emptyUsage() {
      const usage = {} as Record<S, number>;
      for (const surface of surfaceKeys) usage[surface] = 0;
      return usage;
    },
    summarizeImpact: (report) => summarize(report, isPlanKey, defaultPlanKey),
    ...formatters(plans, defaultPlanKey, isPlanKey, config.messages),
  };
}
