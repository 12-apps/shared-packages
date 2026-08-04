import { isGranted, toWireLimit } from './quota';
import { vetoByStatus } from './status';
import type {
  EntitlementDecision,
  EntitlementMap,
  EntitlementReason,
  EntitlementValue,
  FeatureRegistry,
  PlanCatalog,
  ResolvedFeatureDef,
  TenantEntitlementState,
} from './types';

/**
 * Layered entitlement resolution — the heart of the library, and a
 * generalization of `@12-apps/entity-lifecycle`'s three-layer `resolveFeature`
 * from booleans to quotas, from one package's features to any catalog, and
 * with a lifecycle-status layer added.
 *
 * A feature is usable only when every layer says yes, evaluated in this order:
 *
 *   1. **code**   — the build declares it (`FeatureRegistry`)
 *   2. **plan**   — the tenant is entitled (`plan` ∪ `overrides`)
 *   3. **status** — the account is not restricted/suspended
 *   4. **tenant** — the tenant has not switched it off (`settings`)
 *
 * The layers are ordered by who owns them, cheapest denial first, and the
 * REASON is preserved all the way out — that is what lets a host answer 402
 * with an upsell versus 403 versus "you turned this off yourself", instead of
 * collapsing every denial into an indistinguishable "no".
 *
 * An entitled tenant is never forced: layer 4 always wins over layer 2.
 */

/**
 * Layer 1 denial. A feature this build has never heard of is not an upsell
 * opportunity — nobody can buy it. Reached at runtime as well as in type-space
 * because snapshots and wire payloads carry plain strings TypeScript cannot
 * vouch for.
 */
function notSupported<F extends string>(feature: F): EntitlementDecision<F> {
  return {
    feature,
    enabled: false,
    reason: 'not-supported',
    policy: 'hide',
    limit: null,
    requiredPlan: null,
  };
}

/**
 * Layer 2 value. Overrides sit ON TOP of the plan, so the backoffice can both
 * grant a comped feature AND revoke one (an explicit `false`/`0` override wins
 * over a granting plan) without ever editing the plan catalog.
 */
function grantedValue<F extends string>(
  feature: F,
  state: TenantEntitlementState<F>,
): EntitlementValue | undefined {
  const overrides: EntitlementMap<F> = state.overrides ?? {};
  return feature in overrides ? overrides[feature] : state.plan[feature];
}

/**
 * Did the granted value come from the override layer rather than the plan?
 *
 * An override REPLACES the plan value rather than merging with it, so while one
 * stands, no plan the tenant could buy would change the answer. A denial from
 * an override is a platform decision, not a plan gap — see {@link upsellTarget}.
 */
function isOverridden<F extends string>(
  feature: F,
  state: TenantEntitlementState<F>,
): boolean {
  return state.overrides !== undefined && feature in state.overrides;
}

/**
 * The cheapest plan that would unlock a feature, or `null` when no catalog is
 * configured / no plan grants it. Only ever consulted for a `not-entitled`
 * denial — every other reason means the tenant already has it, and offering an
 * upgrade would be a lie.
 */
function upsellTarget<F extends string>(
  feature: F,
  plans: PlanCatalog<F, string> | null | undefined,
): string | null {
  return plans?.cheapestWith(feature)?.key ?? null;
}

/** Layer 4: the tenant's own switch, or the feature's default when untouched. */
function tenantEnabled<F extends string>(
  feature: F,
  state: TenantEntitlementState<F>,
  def: ResolvedFeatureDef,
): boolean {
  return state.settings?.[feature] ?? def.defaultWhenEntitled;
}

export function resolveEntitlement<F extends string>(
  feature: F,
  registry: FeatureRegistry<F>,
  state: TenantEntitlementState<F>,
  plans?: PlanCatalog<F, string> | null,
): EntitlementDecision<F> {
  if (!registry.has(feature)) return notSupported(feature);

  const def = registry.def(feature);
  const granted = grantedValue(feature, state);
  const limit = toWireLimit(granted, def.kind === 'quota');

  /** Every decision below shares this feature's revoke policy and ceiling. */
  const decide = (
    reason: EntitlementReason,
    requiredPlan: string | null,
  ): EntitlementDecision<F> => ({
    feature,
    enabled: reason === 'enabled',
    reason,
    policy: def.onRevoke,
    limit,
    requiredPlan,
  });

  // Layer 2 — plan. The only denial that CAN be an upsell — but not when it
  // came from an explicit override: `cheapestWith` would happily name a plan
  // the tenant is already on (their plan grants the feature; the override is
  // what revoked it), and the host would render "Upgrade to Pro" to somebody
  // already paying for Pro. No upgrade lifts a platform revocation.
  if (!isGranted(granted)) {
    const requiredPlan = isOverridden(feature, state)
      ? null
      : upsellTarget(feature, plans);
    return decide('not-entitled', requiredPlan);
  }

  // Layer 3 — lifecycle status. They already paid for this; the fix is
  // settling up, and that message belongs to the host.
  const veto = vetoByStatus(state.status ?? 'active', def);
  if (veto) return decide(veto, null);

  // Layer 4 — tenant. They have it and switched it off; also not a sale.
  if (!tenantEnabled(feature, state, def)) {
    return decide('disabled-by-tenant', null);
  }

  return decide('enabled', null);
}

/** Resolve every declared feature for a tenant in one pass. */
export function resolveAll<F extends string>(
  registry: FeatureRegistry<F>,
  state: TenantEntitlementState<F>,
  plans?: PlanCatalog<F, string> | null,
): Record<F, EntitlementDecision<F>> {
  const out = {} as Record<F, EntitlementDecision<F>>;
  for (const feature of registry.list) {
    out[feature] = resolveEntitlement(feature, registry, state, plans);
  }
  return out;
}
