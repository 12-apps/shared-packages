import { toLimit } from './quota';
import type {
  EntitlementMap,
  EntitlementValue,
  FeatureRegistry,
  PlanCatalog,
  PlanDef,
  ResolvedPlan,
} from './types';

/**
 * Compile the host's plan catalog.
 *
 * Plans are authored with `extends` so tiers stack without repetition
 * (`pro extends plus extends basic`), but they are **flattened at compile
 * time** — runtime resolution never walks an inheritance chain, so a
 * misconfigured catalog fails at boot rather than mid-request.
 *
 * Two invariants are enforced here:
 *   1. a plan may only reference features declared in the registry — plans
 *      cannot mint new feature keys, exactly as custom roles cannot mint
 *      permissions in `@12-apps/rbac`;
 *   2. `extends` chains must terminate (cycles throw).
 *
 * Declaration order is assumed cheapest -> richest and drives
 * {@link PlanCatalog.cheapestWith}, i.e. the `requiredPlan` in every 402 and
 * therefore the upsell CTA.
 *
 * @example
 * const PLANS = definePlans(FEATURES, {
 *   basic: { entitlements: { 'stock.locations': 1 } },
 *   plus:  { extends: 'basic', entitlements: { mcp: true } },
 *   pro:   { extends: 'plus',  entitlements: { audit: true, 'stock.locations': 'unlimited' } },
 * } as const);
 */
/**
 * Boot-time validation of every `(plan, feature, value)` the catalog declares.
 *
 * Flattened to triples rather than a nested loop: the catalog is tiny and this
 * runs once at boot, but the quality gate treats loop-in-loop as a suspected
 * quadratic hot path, and a flat list reads no worse.
 */
function validateEntitlements<F extends string>(
  registry: FeatureRegistry<F>,
  plans: Record<string, PlanDef<F, string>>,
): void {
  const declared = Object.entries(plans).flatMap(([key, plan]) =>
    Object.entries(plan.entitlements).map(([feature, value]) => ({
      key,
      feature,
      value: value as EntitlementValue | undefined,
    })),
  );

  for (const { key, feature, value } of declared) {
    if (!registry.has(feature)) {
      throw new Error(
        `Plan "${key}" references undeclared feature "${feature}". ` +
          `Add it to the feature registry first — plans cannot mint feature keys.`,
      );
    }
    // A boolean on a QUOTA feature is almost always a typo for a number, and
    // it fails silently in the worst possible direction: `true` normalizes to
    // an uncapped ceiling, so `seats: true` where `seats: 10` was meant hands
    // the tenant unlimited seats. Catch it at boot, where the catalog is
    // authored, rather than on a billing report months later.
    if (
      registry.def(feature).kind === 'quota' &&
      typeof value === 'boolean'
    ) {
      throw new Error(
        `Plan "${key}" gives quota feature "${feature}" the boolean ${String(value)}. ` +
          `Quota features take a number or 'unlimited' — use 0 for none.`,
      );
    }
  }
}

export function definePlans<
  F extends string,
  const M extends Record<string, PlanDef<F, Extract<keyof M, string>>>,
>(registry: FeatureRegistry<F>, plans: M): PlanCatalog<F, keyof M & string> {
  type K = keyof M & string;

  const list = Object.keys(plans) as K[];
  const resolved = new Map<string, ResolvedPlan<F>>();

  validateEntitlements(registry, plans);

  /** Flatten one plan, following `extends` with cycle detection. */
  function flatten(key: K, seen: readonly string[]): EntitlementMap<F> {
    if (seen.includes(key)) {
      throw new Error(
        `Cyclic plan inheritance: ${[...seen, key].join(' -> ')}`,
      );
    }
    const plan = plans[key];
    if (!plan) throw new Error(`Unknown plan: "${key}"`);

    const parentKey = plan.extends;
    const inherited: EntitlementMap<F> = parentKey
      ? flatten(parentKey as K, [...seen, key])
      : {};

    // Own entries win — a richer tier may also DOWNGRADE an inherited entry
    // (e.g. set a quota to 0) rather than only adding to it.
    return { ...inherited, ...plan.entitlements };
  }

  list.forEach((key, rank) => {
    const plan = plans[key];
    resolved.set(key, {
      key,
      entitlements: flatten(key, []),
      description: plan?.description ?? null,
      rank,
    });
  });

  return {
    list,
    get(key: K): ResolvedPlan<F> {
      const plan = resolved.get(key);
      if (!plan) throw new Error(`Unknown plan: "${String(key)}"`);
      return plan;
    },
    cheapestWith(feature: F, minLimit = 0): ResolvedPlan<F> | null {
      for (const key of list) {
        const plan = resolved.get(key);
        if (plan && toLimit(plan.entitlements[feature]) > minLimit) return plan;
      }
      return null;
    },
  };
}
