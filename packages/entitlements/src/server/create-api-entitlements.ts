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
 *    tenant, and which permissions they hold. The host hands over an
 *    {@link EntitlementsActor}; the package narrows against it, never computes
 *    it.
 *  - **Where tenant state lives** — the `source` port. The tenant row (its
 *    plan key, overrides, switches, status) is a HOST table this package has
 *    no business knowing the shape of.
 *  - **The commercial policy** — the tiers, what they are called, and what
 *    they cost. `plans`, `pricing`, `comparison` and `formatPrice` are all
 *    required, because every one of them is a fact about the host's product
 *    and none of them is a fact about entitlements.
 *  - **Money** — entirely. The plan and the plan-change lead are billing
 *    models that STAY in the host: the ladder arrives as config, prices arrive
 *    as already-formatted display data, and the ask writes through the
 *    {@link PlanChangeRequestPort} — a lead for a human, never a checkout, and
 *    never a package-owned table.
 *  - **The words** — `messages` is required for the same reason `formatPrice`
 *    is: every sentence this surface answers with is host vocabulary, and the
 *    compiled-in defaults were one product's Portuguese.
 *
 * Every one of those is checked at ASSEMBLY (`assertApiEntitlementsConfig`):
 * a required option nobody validates is still fail-open, and an empty
 * collection is refused rather than read as a deliberate lockout.
 */
import { createEntitlements, type EntitlementsEngine } from '../core/engine';
import type { UsageCounter } from '../core/types';
import type { TenantPlanPayload, TenantPlanView } from '../plan-wire';
import {
  assertApiEntitlementsConfig,
  type ApiEntitlementsConfig,
  type UsageRegistryLike,
} from './config';
import { PLAN_REQUEST_PERMISSION } from './contribution';
import { createPlanService } from './plan-service';
import { buildEntitlementsRoutes, type EntitlementsRoute } from './routes';

export type {
  EntitlementsActor,
  EntitlementsRequest,
  EntitlementsRoute,
  PlanChangeRequestPort,
} from './routes';
export {
  assertApiEntitlementsConfig,
  EntitlementsConfigError,
  type ApiEntitlementsConfig,
  type UsageRegistryLike,
} from './config';

function isUsageRegistry<F extends string>(
  usage: UsageCounter<F> | UsageRegistryLike<F>,
): usage is UsageRegistryLike<F> {
  return 'port' in usage;
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
  /** What the tenant is on, and what they get — with live quota usage. */
  getPlanView(tenantId: string): Promise<TenantPlanView>;
  /** The plan screen's whole payload: the view plus the pricing cards. */
  getPlanPayload(tenantId: string): Promise<TenantPlanPayload>;
}

/** Unwrap the usage input, running the registry's boot-time audit if present. */
function usagePortOf<F extends string, K extends string>(
  config: ApiEntitlementsConfig<F, K>,
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

export function createApiEntitlements<F extends string, K extends string>(
  config: ApiEntitlementsConfig<F, K>,
): ApiEntitlements<F> {
  assertApiEntitlementsConfig(config);

  const plans = config.plans;
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
    pricing: config.pricing,
    comparison: config.comparison,
    formatPrice: config.formatPrice,
    messages: config.messages,
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
        : config.pricing.some((row) => row.key === key),
    requestPermission: config.planRequestPermission ?? PLAN_REQUEST_PERMISSION,
    messages: config.messages,
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
