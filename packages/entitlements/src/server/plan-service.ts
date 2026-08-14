/**
 * The plan reads behind the surface: what the tenant is on, with live quota
 * usage measured through the host's counters — assembled here so the routes
 * and any host-side caller resolve the SAME view the gate enforces.
 */
import type { EntitlementsEngine } from '../core/engine';
import type {
  EntitlementDecision,
  FeatureRegistry,
  PlanCatalog,
  UsageCounter,
} from '../core/types';
import type { ComparisonTier, TenantPlanPayload, TenantPlanView } from '../plan-wire';
import { buildTenantPlanView, type PricingRow, type QuotaUsageView } from './plan-view';

interface PlanServiceConfig<F extends string> {
  engine: EntitlementsEngine<F>;
  features: FeatureRegistry<F>;
  plans: PlanCatalog<F, string> | null;
  usage: UsageCounter<F> | null;
  defaultPlanKey: string;
  pricing: readonly PricingRow[];
  comparison?: ((currentPlanKey: string) => ComparisonTier[]) | undefined;
  /** Required — the host's currency wording. See `plan-view.ts`. */
  formatPrice: (priceCents: number | null) => string | null;
}

export interface PlanService {
  getPlanView(tenantId: string): Promise<TenantPlanView>;
  getPlanPayload(tenantId: string): Promise<TenantPlanPayload>;
}

/** Is this an ENABLED quota row the host can measure? */
function isMeasurableQuota<F extends string>(
  features: FeatureRegistry<F>,
  decision: EntitlementDecision<F>,
): boolean {
  return (
    decision.enabled && features.has(decision.feature) && features.def(decision.feature).kind === 'quota'
  );
}

export function createPlanService<F extends string>(config: PlanServiceConfig<F>): PlanService {
  const { engine, features, plans, usage: usagePort } = config;

  async function getPlanView(tenantId: string): Promise<TenantPlanView> {
    const snapshot = await engine.toSnapshot(tenantId);

    // Live usage for every ENABLED quota row, so the screen can show the
    // tenant where they stand — and, when they hold more than the ceiling
    // (grandfathered or downgraded), offer the tier whose ceiling clears what
    // they HOLD (`cheapestWith(feature, used)`), not merely the one above
    // their plan: a tenant holding 340 units must not be sold the 200 tier.
    const usage: Record<string, QuotaUsageView> = {};
    const decisions = Object.values(snapshot.features) as EntitlementDecision<F>[];
    await Promise.all(
      decisions
        .filter((decision) => usagePort !== null && isMeasurableQuota(features, decision))
        .map(async (decision) => {
          if (usagePort === null) return;
          const used = await usagePort.count(tenantId, decision.feature);
          usage[decision.feature] = {
            used,
            nextPlan: plans?.cheapestWith(decision.feature, used)?.key ?? null,
          };
        }),
    );

    return buildTenantPlanView(
      snapshot.planKey ?? config.defaultPlanKey,
      snapshot.features,
      config.pricing,
      // `def` throws on an unknown key, and the snapshot only ever contains
      // declared ones — but guard anyway rather than let a catalog change
      // take the tenant's plan screen down.
      (feature) => (features.has(feature) ? features.def(feature).description : null),
      usage,
      config.formatPrice,
    );
  }

  return {
    getPlanView,
    async getPlanPayload(tenantId) {
      const view = await getPlanView(tenantId);
      return { ...view, comparison: config.comparison?.(view.planKey) ?? [] };
    },
  };
}
