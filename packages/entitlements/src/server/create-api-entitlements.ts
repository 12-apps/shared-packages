/**
 * The one thing this package exposes to a BACKEND host: the entitlement
 * surface as a factory over config.
 *
 * The endpoints used to live in the host — route files that parsed a request,
 * called the engine, and shaped a response. Only the middle step was ever the
 * host's business: the parsing, the status codes and the envelope are this
 * surface's contract, and the frontend half of that contract lives in this
 * same package (`./react`). Splitting one contract across two repositories is
 * how a client and a server drift.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors (routes.ts), not a Hono/Express
 * router — this package must not take a web framework as a dependency.
 * `@12-apps/entitlements/hono` adapts them; another framework's adapter is
 * about the same size.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication and tenant resolution** — who is calling, on which
 *    tenant, and whether they may file a plan-change request. The host hands
 *    over an {@link EntitlementsActor}; the package narrows against it, never
 *    computes it.
 *  - **Where tenant state lives** — the `source` port. The tenant row (its
 *    plan key, overrides, switches, status) is a HOST table this package has
 *    no business knowing the shape of.
 *  - **Money** — entirely. `Plan`, `Subscription` and the plan-change lead
 *    are billing models that STAY in the host: the plan the engine consumes
 *    arrives as config/data (`plans`, `pricing`, `comparison`), and the
 *    plan-change request writes through the {@link PlanChangeRequestPort} —
 *    a lead for a human, never a checkout, and never a package-owned table.
 */
import { createEntitlements, type EntitlementsEngine } from '../core/engine';
import type {
  EntitlementCache,
  EntitlementSource,
  FeatureRegistry,
  PlanCatalog,
  UsageCounter,
} from '../core/types';
import type { ComparisonTier, TenantPlanPayload, TenantPlanView } from '../plan-wire';
import { createPlanService } from './plan-service';
import type { PricingRow } from './plan-view';
import { buildEntitlementsRoutes, type EntitlementsRoute, type PlanChangeRequestPort } from './routes';

export type {
  EntitlementsActor,
  EntitlementsRequest,
  EntitlementsRoute,
  PlanChangeRequestPort,
} from './routes';

/** A usage registry (usage-registry.ts) — the port plus its boot-time audit. */
export interface UsageRegistryLike<F extends string> {
  port: UsageCounter<F>;
  assertRegistered(quotaFeatures: readonly string[]): void;
}

function isUsageRegistry<F extends string>(
  usage: UsageCounter<F> | UsageRegistryLike<F>,
): usage is UsageRegistryLike<F> {
  return 'port' in usage;
}

export interface ApiEntitlementsConfig<F extends string> {
  features: FeatureRegistry<F>;
  /** The tier ladder — config/data, authored by the host. Null for hand-assigned maps. */
  plans?: PlanCatalog<F, string> | null;
  /** Where the tenant's entitlement state lives (a HOST table, behind a port). */
  source: EntitlementSource<F>;
  /**
   * Usage counters for quota features. Pass the registry from
   * `createUsageRegistry` to also get its boot-time audit: an engine whose
   * catalog declares a quota this host cannot count refuses to build at all.
   */
  usage?: UsageCounter<F> | UsageRegistryLike<F> | null;
  cache?: EntitlementCache | null;
  cacheTtlSeconds?: number;
  /** The tier a tenant with no recognisable plan key resolves to. */
  defaultPlanKey: string;
  /** Pricing DISPLAY rows from the host's billing (never computed here). */
  pricing?: readonly PricingRow[];
  /** The pricing cards, assembled by the host's billing catalog. */
  comparison?: (currentPlanKey: string) => ComparisonTier[];
  /**
   * How a price in cents reads on the wire (`TenantPlanView.price`).
   * Defaults to the BRL wording future-pay ships (`"R$ 59,00"` / `"Grátis"`).
   */
  formatPrice?: (priceCents: number | null) => string | null;
  /** The plan-change lead store. Omit it and the request routes do not exist. */
  planChangeRequests?: PlanChangeRequestPort | null;
}

export interface ApiEntitlements<F extends string> {
  /** The engine, for host-side gates beyond the mounted routes. */
  engine: EntitlementsEngine<F>;
  routes: EntitlementsRoute[];
  /** `require` → throws; the adapter (or the host handler) maps the denial. */
  requireEntitlement(tenantId: string, feature: F): Promise<void>;
  /**
   * Require headroom before creating the `need`-th unit. NOT atomic — this is
   * the friendly 402; `createWithinQuota` is what actually enforces a ceiling
   * that must never be overrun.
   */
  requireQuota(
    tenantId: string,
    feature: F,
    need?: number,
  ): Promise<{ limit: number | 'unlimited' | null }>;
  /** Non-throwing read for surfaces that RENDER a denied state. */
  checkEntitlement(
    tenantId: string,
    feature: F,
  ): Promise<{ enabled: boolean; reason: string; requiredPlan: string | null }>;
  /** What the store is on, and what it gets — with live quota usage. */
  getPlanView(tenantId: string): Promise<TenantPlanView>;
  /** The plan screen's whole payload: the view plus the pricing cards. */
  getPlanPayload(tenantId: string): Promise<TenantPlanPayload>;
}

/** Unwrap the usage input, running the registry's boot-time audit if present. */
function usagePortOf<F extends string>(
  config: ApiEntitlementsConfig<F>,
): UsageCounter<F> | null {
  const usage = config.usage ?? null;
  if (usage === null) return null;
  if (!isUsageRegistry(usage)) return usage;
  // The audit: a quota the host cannot count would otherwise read `used = 0`
  // forever and the ceiling would silently never be enforced.
  usage.assertRegistered(
    config.features.list.filter((feature) => config.features.def(feature).kind === 'quota'),
  );
  return usage.port;
}

export function createApiEntitlements<F extends string>(
  config: ApiEntitlementsConfig<F>,
): ApiEntitlements<F> {
  const plans = config.plans ?? null;
  const pricing = config.pricing ?? [];
  const usage = usagePortOf(config);

  const engine = createEntitlements({
    features: config.features,
    plans: plans ?? undefined,
    source: config.source,
    usage: usage ?? undefined,
    cache: config.cache ?? null,
    ...(config.cacheTtlSeconds === undefined ? {} : { cacheTtlSeconds: config.cacheTtlSeconds }),
  });

  const service = createPlanService({
    engine,
    features: config.features,
    plans,
    usage,
    defaultPlanKey: config.defaultPlanKey,
    pricing,
    comparison: config.comparison,
    formatPrice: config.formatPrice,
  });

  const routes = buildEntitlementsRoutes({
    engine,
    service,
    leads: config.planChangeRequests ?? null,
    // The ladder is the authority on what can be asked for; a host without
    // one falls back to the priced keys.
    isKnownPlan: (key) =>
      plans !== null
        ? (plans.list as readonly string[]).includes(key)
        : pricing.some((row) => row.key === key),
  });

  return {
    engine,
    routes,
    async requireEntitlement(tenantId, feature) {
      await engine.require(tenantId, feature);
    },
    async requireQuota(tenantId, feature, need = 1) {
      const decision = await engine.requireQuota(tenantId, feature, need);
      return { limit: decision.limit };
    },
    async checkEntitlement(tenantId, feature) {
      const decision = await engine.check(tenantId, feature);
      return {
        enabled: decision.enabled,
        reason: decision.reason,
        requiredPlan: decision.requiredPlan,
      };
    },
    getPlanView: service.getPlanView,
    getPlanPayload: service.getPlanPayload,
  };
}
