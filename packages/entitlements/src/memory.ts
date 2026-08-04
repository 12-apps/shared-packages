import type {
  EntitlementCache,
  EntitlementSource,
  TenantEntitlementState,
  UsageCounter,
} from './core/types';

/**
 * In-memory adapters — for tests, the portability suite, local development and
 * any host that has no database yet. Mirrors `@12-apps/entity-lifecycle`'s
 * `memory.ts`. Nothing here is production storage.
 */

export interface MemorySource<F extends string> extends EntitlementSource<F> {
  /** Seed or replace a tenant's state. */
  set(tenantId: string, state: TenantEntitlementState<F>): void;
  /** Merge a partial update into a tenant's state (e.g. flip status). */
  patch(tenantId: string, patch: Partial<TenantEntitlementState<F>>): void;
  clear(): void;
}

/**
 * A source backed by a `Map`. Unknown tenants resolve to an empty plan rather
 * than throwing — deny-by-default is the safe reading of "I've never heard of
 * this tenant".
 */
export function createMemorySource<F extends string>(
  seed: Record<string, TenantEntitlementState<F>> = {},
): MemorySource<F> {
  const store = new Map<string, TenantEntitlementState<F>>(
    Object.entries(seed),
  );

  return {
    async load(tenantId) {
      return store.get(tenantId) ?? { plan: {} };
    },
    set(tenantId, state) {
      store.set(tenantId, state);
    },
    patch(tenantId, patch) {
      store.set(tenantId, { ...(store.get(tenantId) ?? { plan: {} }), ...patch });
    },
    clear() {
      store.clear();
    },
  };
}

export interface MemoryUsage<F extends string> extends UsageCounter<F> {
  set(tenantId: string, feature: F, used: number): void;
  clear(): void;
}

/** A usage counter backed by a `Map`, keyed `tenantId::feature`. */
export function createMemoryUsage<F extends string>(
  seed: Record<string, number> = {},
): MemoryUsage<F> {
  const store = new Map<string, number>(Object.entries(seed));
  const key = (tenantId: string, feature: F): string =>
    `${tenantId}::${feature}`;

  return {
    async count(tenantId, feature) {
      return store.get(key(tenantId, feature)) ?? 0;
    },
    set(tenantId, feature, used) {
      store.set(key(tenantId, feature), used);
    },
    clear() {
      store.clear();
    },
  };
}

export interface MemoryCache extends EntitlementCache {
  /** How many times `get` was served from the store — asserts caching works. */
  hits(): number;
  size(): number;
  clear(): void;
}

/**
 * A cache backed by a `Map`. TTL is accepted and ignored: expiry would need a
 * clock, and a test that depends on wall-clock time is a flaky test. Hosts use
 * Redis in production.
 */
export function createMemoryCache(): MemoryCache {
  const store = new Map<string, string>();
  let hits = 0;

  return {
    async get(key) {
      const value = store.get(key);
      if (value !== undefined) hits += 1;
      return value ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async del(key) {
      store.delete(key);
    },
    hits: () => hits,
    size: () => store.size,
    clear: () => {
      store.clear();
      hits = 0;
    },
  };
}
