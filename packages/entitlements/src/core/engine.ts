import { EntitlementRequiredError, QuotaExceededError } from './errors';
import { isExceeded, remainingOf } from './quota';
import { resolveAll, resolveEntitlement } from './resolve';
import type {
  EntitlementCache,
  EntitlementDecision,
  EntitlementSnapshot,
  EntitlementSource,
  FeatureRegistry,
  PlanCatalog,
  QuotaDecision,
  TenantEntitlementState,
  UsageCounter,
} from './types';

/** Everything the engine needs. Only `features` and `source` are required. */
export interface EntitlementsConfig<F extends string, K extends string> {
  /** The host's feature catalog ({@link defineFeatures}). */
  features: FeatureRegistry<F>;
  /**
   * The host's plan catalog ({@link definePlans}). Optional: a host with
   * hand-assigned entitlements and no tiers still gets full gating — it just
   * cannot populate `requiredPlan`, so denials carry no upsell.
   */
  plans?: PlanCatalog<F, K> | null;
  /** Port: where a tenant's entitlement state comes from. */
  source: EntitlementSource<F>;
  /** Port: live usage, required only if the catalog declares quota features. */
  usage?: UsageCounter<F> | null;
  /** Port: optional read-through cache for the source. */
  cache?: EntitlementCache | null;
  /** Cache TTL. Defaults to 300s. Correctness comes from `invalidate`, not TTL. */
  cacheTtlSeconds?: number;
  /** Cache key prefix. Defaults to `'entitlements'`. */
  cacheKeyPrefix?: string;
}

export interface EntitlementsEngine<F extends string> {
  /** Raw tenant state, read through the cache. */
  load(tenantId: string): Promise<TenantEntitlementState<F>>;
  /** Resolve one feature. Never throws for a denial — inspect `.enabled`. */
  check(tenantId: string, feature: F): Promise<EntitlementDecision<F>>;
  /** Resolve one quota feature and its live usage. */
  checkQuota(tenantId: string, feature: F): Promise<QuotaDecision<F>>;
  /** Resolve every declared feature in one pass. */
  checkAll(tenantId: string): Promise<Record<F, EntitlementDecision<F>>>;
  /** Throw {@link EntitlementRequiredError} unless the feature is usable. */
  require(tenantId: string, feature: F): Promise<EntitlementDecision<F>>;
  /**
   * Throw unless the feature is usable AND `need` more units fit in the quota.
   *
   * Note this asks a different question from {@link checkQuota}'s `exceeded`.
   * `exceeded` describes the quota's CURRENT state ("you are at your ceiling");
   * this asks whether `need` MORE units would fit. At `used === limit` the two
   * therefore disagree for `need = 0`, by design: a host passing
   * `need: items.length` for an empty batch is creating nothing, and refusing a
   * no-op write would be the bug. The returned decision still reports
   * `exceeded: true` — it is describing the quota, not the request.
   *
   * ⚠️ Check-then-act is not atomic — see {@link UsageCounter}. Call this
   * inside the same transaction as the insert, or back it with a DB
   * constraint, whenever an overage would actually matter.
   */
  requireQuota(
    tenantId: string,
    feature: F,
    need?: number,
  ): Promise<QuotaDecision<F>>;
  /** The JSON-serializable projection to hand a browser. */
  toSnapshot(tenantId: string): Promise<EntitlementSnapshot<F>>;
  /** Drop cached state. Call on ANY plan / override / settings / status write. */
  invalidate(tenantId: string): Promise<void>;
}

/** Resolved config, threaded to the module-level workers below. */
interface EngineCtx<F extends string> {
  features: FeatureRegistry<F>;
  plans: PlanCatalog<F, string> | null;
  source: EntitlementSource<F>;
  usage: UsageCounter<F> | null;
  cache: EntitlementCache | null;
  ttl: number;
  key(tenantId: string): string;
}

/** A wire ceiling normalized for comparison. `null` (boolean) reads unbounded. */
function numericLimit(limit: number | 'unlimited' | null): number {
  return limit === 'unlimited' || limit === null
    ? Number.POSITIVE_INFINITY
    : limit;
}

/**
 * Best-effort cache read. Returns `null` — "no usable cached value" — for a
 * miss, a corrupt entry AND an unreachable cache alike.
 *
 * The cache is an optimization over an authoritative source, so no failure of
 * it may fail a gate. That has to cover every call, not just the parse: if
 * Redis is down, `get` rejects long before a corrupt entry could, and an
 * unguarded `del` in the recovery path would re-throw the very outage it is
 * recovering from. Falling through costs a source read; throwing would deny
 * every request for the tenant until the TTL expired.
 */
async function readCache<F extends string>(
  cache: EntitlementCache,
  key: string,
): Promise<TenantEntitlementState<F> | null> {
  const hit = await cache.get(key).catch(() => null);
  if (hit === null) return null;
  try {
    return JSON.parse(hit) as TenantEntitlementState<F>;
  } catch {
    // Corrupt or legacy entry: evict it so the next read repopulates, but if
    // the eviction itself fails the entry simply self-heals at TTL.
    await cache.del(key).catch(() => undefined);
    return null;
  }
}

/** Best-effort cache write; a failure only costs the next read a source hit. */
async function writeCache(
  cache: EntitlementCache,
  key: string,
  value: string,
  ttl: number,
): Promise<void> {
  await cache.set(key, value, ttl).catch(() => undefined);
}

/** Read tenant state through the cache, tolerating a poisoned or absent one. */
async function loadState<F extends string>(
  ctx: EngineCtx<F>,
  tenantId: string,
): Promise<TenantEntitlementState<F>> {
  if (!ctx.cache) return ctx.source.load(tenantId);

  const key = ctx.key(tenantId);
  const cached = await readCache<F>(ctx.cache, key);
  if (cached !== null) return cached;

  const state = await ctx.source.load(tenantId);
  await writeCache(ctx.cache, key, JSON.stringify(state), ctx.ttl);
  return state;
}

async function checkOne<F extends string>(
  ctx: EngineCtx<F>,
  tenantId: string,
  feature: F,
): Promise<EntitlementDecision<F>> {
  const state = await loadState(ctx, tenantId);
  return resolveEntitlement(feature, ctx.features, state, ctx.plans);
}

async function checkQuotaOne<F extends string>(
  ctx: EngineCtx<F>,
  tenantId: string,
  feature: F,
): Promise<QuotaDecision<F>> {
  // Calling this on a boolean feature is a programming error, not a runtime
  // condition — fail loudly rather than inventing a plausible answer.
  if (ctx.features.has(feature) && ctx.features.def(feature).kind !== 'quota') {
    throw new Error(
      `Feature "${feature}" is not declared as a quota; use check() instead.`,
    );
  }

  const decision = await checkOne(ctx, tenantId, feature);

  // Not entitled at all: no point counting rows the tenant cannot create.
  if (!decision.enabled) {
    return { ...decision, used: 0, remaining: 0, exceeded: true };
  }
  if (!ctx.usage) {
    throw new Error(
      `Quota feature "${feature}" was checked but no UsageCounter port is configured.`,
    );
  }

  const used = await ctx.usage.count(tenantId, feature);
  const limit = numericLimit(decision.limit);
  return {
    ...decision,
    used,
    remaining: remainingOf(limit, used),
    exceeded: isExceeded(limit, used),
  };
}

/**
 * Build the entitlements engine — a module singleton, like `@12-apps/rbac`'s
 * `createRbac`. The only app-specific parts are the two ports.
 *
 * Throws for an EMPTY feature catalog, at the point the hazard lives. An engine
 * over `list: []` answers `not-supported` for every key, and `withEntitlement`
 * renders `not-supported` UNLOCKED on purpose (a stale client must never
 * paywall a page the tenant owns) — so "declare no features" opens every
 * plan-gated page instead of closing one. `defineFeatures` refuses to BUILD an
 * empty registry, which closes the ordinary path; this closes the other, since
 * `FeatureRegistry` is a published interface a host can implement itself. The
 * backend surface's `assertApiEntitlementsConfig` covers neither — this factory
 * is exported from the package ROOT and never runs it.
 *
 * @example
 * export const entitlements = createEntitlements({
 *   features: FEATURES,
 *   plans: PLANS,
 *   source: { load: (id) => loadTenantEntitlements(id) },
 *   usage:  { count: (id, f) => countUsage(id, f) },
 *   cache:  redisCache,
 * });
 */
export function createEntitlements<F extends string, K extends string = string>(
  config: EntitlementsConfig<F, K>,
): EntitlementsEngine<F> {
  if (config.features.list.length === 0) {
    throw new Error(
      'createEntitlements: `features` declares no feature keys. An empty catalog does ' +
        'not gate anything — every key resolves `not-supported`, which the page gate ' +
        'renders UNLOCKED, so it opens every plan-gated page instead of closing one. ' +
        'Build the catalog with defineFeatures().',
    );
  }
  const prefix = config.cacheKeyPrefix ?? 'entitlements';
  const ctx: EngineCtx<F> = {
    features: config.features,
    plans: config.plans ?? null,
    source: config.source,
    usage: config.usage ?? null,
    cache: config.cache ?? null,
    ttl: config.cacheTtlSeconds ?? 300,
    key: (tenantId) => `${prefix}:${tenantId}`,
  };

  return {
    load: (tenantId) => loadState(ctx, tenantId),
    check: (tenantId, feature) => checkOne(ctx, tenantId, feature),
    checkQuota: (tenantId, feature) => checkQuotaOne(ctx, tenantId, feature),

    async checkAll(tenantId) {
      return resolveAll(ctx.features, await loadState(ctx, tenantId), ctx.plans);
    },

    async require(tenantId, feature) {
      const decision = await checkOne(ctx, tenantId, feature);
      if (!decision.enabled) {
        throw new EntitlementRequiredError(tenantId, decision);
      }
      return decision;
    },

    async requireQuota(tenantId, feature, need = 1) {
      const decision = await checkQuotaOne(ctx, tenantId, feature);
      if (!decision.enabled) {
        throw new EntitlementRequiredError(tenantId, decision);
      }
      const limit = numericLimit(decision.limit);
      if (decision.used + need > limit) {
        // Upsell to the cheapest plan that clears the CURRENT ceiling, not
        // merely one that grants the feature — the tenant already has that.
        const next = ctx.plans?.cheapestWith(feature, limit)?.key ?? null;
        throw new QuotaExceededError(tenantId, {
          ...decision,
          exceeded: true,
          requiredPlan: next,
        });
      }
      return decision;
    },

    async toSnapshot(tenantId) {
      const state = await loadState(ctx, tenantId);
      return {
        tenantId,
        status: state.status ?? 'active',
        planKey: state.planKey ?? null,
        features: resolveAll(ctx.features, state, ctx.plans),
      };
    },

    async invalidate(tenantId) {
      if (ctx.cache) await ctx.cache.del(ctx.key(tenantId));
    },
  };
}
