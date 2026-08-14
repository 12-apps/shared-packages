import { describe, expect, it } from 'vitest';

import { createEntitlements } from '../core/engine';
import { EntitlementRequiredError, QuotaExceededError } from '../core/errors';
import {
  createMemoryCache,
  createMemorySource,
  createMemoryUsage,
  type MemoryCache,
} from '../memory';
import { FEATURES, PLANS, type AppFeature } from './fixtures';

const TENANT = 'tenant-1';

/**
 * One engine + one set of ports PER CALL, and every test calls it for itself.
 * The downgrade and dunning suites below rewrite the tenant's state mid-test
 * (`source.set` / `source.patch`), so a trio hoisted out of the tests would
 * hand the next test whatever plan the previous one happened to leave behind —
 * the suite would pass or fail depending on its running order.
 *
 * The ports are held in one object instead of three separate `const`s so that
 * no binding named `source` / `usage` / `engine` exists outside a test body at
 * all: there is then nothing for a later edit to accidentally reach for and
 * share.
 */
function build(cache: MemoryCache | null = null) {
  const ports = {
    source: createMemorySource<AppFeature>(),
    usage: createMemoryUsage<AppFeature>(),
    cache,
  };
  ports.source.set(TENANT, {
    plan: PLANS.get('station').entitlements,
    planKey: 'station',
  });
  return {
    ...ports,
    engine: createEntitlements({ features: FEATURES, plans: PLANS, ...ports }),
  };
}

describe('check / require', () => {
  it('resolves through the ports', async () => {
    const { engine } = build();
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(true);
    expect((await engine.check(TENANT, 'forecast.history')).enabled).toBe(false);
  });

  it('throws EntitlementRequiredError with an upsell payload', async () => {
    const { engine } = build();
    await expect(engine.require(TENANT, 'forecast.history')).rejects.toThrow(
      EntitlementRequiredError,
    );
    const error = await engine.require(TENANT, 'forecast.history').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntitlementRequiredError);
    expect((error as EntitlementRequiredError<AppFeature>).toPayload()).toEqual({
      error: 'entitlement_required',
      feature: 'forecast.history',
      reason: 'not-entitled',
      requiredPlan: 'network',
    });
  });

  it('returns the decision when entitled', async () => {
    const { engine } = build();
    await expect(engine.require(TENANT, 'alerts.webhook')).resolves.toMatchObject({
      enabled: true,
    });
  });

  it('denies an unknown tenant by default', async () => {
    const { engine } = build();
    expect((await engine.check('who-dis', 'alerts.webhook')).enabled).toBe(false);
  });
});

describe('quotas', () => {
  it('reports usage against the plan ceiling', async () => {
    const { engine, usage } = build();
    usage.set(TENANT, 'stations.online', 3);
    const decision = await engine.checkQuota(TENANT, 'stations.online');
    expect(decision).toMatchObject({
      limit: 5,
      used: 3,
      remaining: 2,
      exceeded: false,
    });
  });

  it('refuses a create that would breach the ceiling', async () => {
    const { engine, usage } = build();
    usage.set(TENANT, 'stations.online', 5);
    await expect(
      engine.requireQuota(TENANT, 'stations.online'),
    ).rejects.toThrow(QuotaExceededError);
  });

  it('accounts for a bulk create via `need`', async () => {
    const { engine, usage } = build();
    usage.set(TENANT, 'stations.online', 3);
    await expect(
      engine.requireQuota(TENANT, 'stations.online', 2),
    ).resolves.toBeDefined();
    await expect(
      engine.requireQuota(TENANT, 'stations.online', 3),
    ).rejects.toThrow(QuotaExceededError);
  });

  it('upsells past the CURRENT ceiling, not to a plan the tenant already has', async () => {
    const { engine, usage } = build();
    usage.set(TENANT, 'stations.online', 5);
    const error = await engine
      .requireQuota(TENANT, 'stations.online')
      .catch((e: unknown) => e);
    // On station (5). hobby (1) and station (5) are both useless — network is it.
    expect((error as QuotaExceededError<AppFeature>).toPayload()).toEqual({
      error: 'quota_exceeded',
      feature: 'stations.online',
      used: 5,
      limit: 5,
      requiredPlan: 'network',
    });
  });

  it('permits a no-op bulk create at the ceiling while still reporting exceeded', async () => {
    // `need = 0` asks "do zero more units fit?" — always yes. A host passing
    // `need: items.length` for an empty batch is creating nothing, and refusing
    // a no-op write would be the bug. The decision still reports the quota's
    // own state (`exceeded: true`); the two answer different questions.
    const { engine, usage } = build();
    usage.set(TENANT, 'stations.online', 5);
    const decision = await engine.requireQuota(TENANT, 'stations.online', 0);
    expect(decision.exceeded).toBe(true);
  });

  it('never exceeds an unlimited quota', async () => {
    const { engine, source, usage } = build();
    source.set(TENANT, { plan: PLANS.get('network').entitlements });
    usage.set(TENANT, 'stations.online', 10_000);
    const decision = await engine.checkQuota(TENANT, 'stations.online');
    expect(decision.exceeded).toBe(false);
    expect(decision.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('short-circuits an unentitled quota without consulting the counter', async () => {
    const source = createMemorySource<AppFeature>();
    source.set(TENANT, { plan: {} });
    // The tally hangs off an object so the stub port mutates a field of a value
    // this test owns, rather than closing over a bare counter variable that
    // reads like ambient state.
    const counter = { calls: 0 };
    const engine = createEntitlements({
      features: FEATURES,
      plans: PLANS,
      source,
      usage: {
        async count() {
          counter.calls += 1;
          return 0;
        },
      },
    });
    await expect(
      engine.requireQuota(TENANT, 'stations.online'),
    ).rejects.toThrow(EntitlementRequiredError);
    expect(counter.calls).toBe(0);
  });

  it('fails loudly when a boolean feature is checked as a quota', async () => {
    const { engine } = build();
    await expect(engine.checkQuota(TENANT, 'alerts.webhook')).rejects.toThrow(
      /not declared as a quota/,
    );
  });

  it('fails loudly when a quota is checked with no UsageCounter wired', async () => {
    const source = createMemorySource<AppFeature>();
    source.set(TENANT, { plan: PLANS.get('station').entitlements });
    const engine = createEntitlements({ features: FEATURES, plans: PLANS, source });
    await expect(
      engine.checkQuota(TENANT, 'stations.online'),
    ).rejects.toThrow(/no UsageCounter port is configured/);
  });
});

describe('downgrade', () => {
  it('closes the gate without touching data, and reports the revoke policy', async () => {
    const { engine, source, usage } = build();
    usage.set(TENANT, 'stations.online', 4);

    // Downgrade station -> hobby. The 4 existing locations are untouched.
    source.set(TENANT, { plan: PLANS.get('hobby').entitlements, planKey: 'hobby' });

    const decision = await engine.checkQuota(TENANT, 'stations.online');
    expect(decision.enabled).toBe(true); // still entitled, just smaller
    expect(decision.limit).toBe(1);
    expect(decision.used).toBe(4); // rows survived
    expect(decision.exceeded).toBe(true); // but no new ones
    expect(decision.policy).toBe('readonly');

    await expect(
      engine.requireQuota(TENANT, 'stations.online'),
    ).rejects.toThrow(QuotaExceededError);

    // And MCP, lost entirely, tells the host to deactivate-not-delete.
    const webhook = await engine.check(TENANT, 'alerts.webhook');
    expect(webhook).toMatchObject({ enabled: false, policy: 'disable' });
  });

  it('restores everything on re-upgrade — no data migration needed', async () => {
    const { engine, source } = build();
    source.set(TENANT, { plan: PLANS.get('hobby').entitlements });
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(false);
    source.set(TENANT, { plan: PLANS.get('network').entitlements });
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(true);
    expect((await engine.check(TENANT, 'forecast.history')).enabled).toBe(true);
  });
});

describe('lifecycle status (dunning reuses the same guard)', () => {
  it('restricting a tenant closes gates without any separate lock mechanism', async () => {
    const { engine, source } = build();
    source.patch(TENANT, { status: 'restricted' });
    await expect(engine.require(TENANT, 'alerts.webhook')).rejects.toThrow(
      EntitlementRequiredError,
    );
    // ...but the retained read path stays open.
    await expect(engine.require(TENANT, 'readings.read')).resolves.toBeDefined();
  });

  it('offers no upsell for a restricted denial', async () => {
    const { engine, source } = build();
    source.patch(TENANT, { status: 'restricted' });
    const error = await engine.require(TENANT, 'alerts.webhook').catch((e: unknown) => e);
    expect((error as EntitlementRequiredError<AppFeature>).requiredPlan).toBeNull();
  });
});

describe('snapshot', () => {
  it('is JSON-serializable and covers every feature', async () => {
    const { engine } = build();
    const snapshot = await engine.toSnapshot(TENANT);
    expect(snapshot.tenantId).toBe(TENANT);
    expect(snapshot.planKey).toBe('station');
    expect(snapshot.status).toBe('active');
    expect(Object.keys(snapshot.features).sort()).toEqual([...FEATURES.list].sort());

    const round = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(round).toEqual(snapshot);
  });

  it('carries the reason so a client can tell an upsell from a self-disable', async () => {
    const { engine, source } = build();
    source.patch(TENANT, { settings: { 'alerts.webhook': false } });
    const snapshot = await engine.toSnapshot(TENANT);
    expect(snapshot.features['alerts.webhook'].reason).toBe('disabled-by-tenant');
    expect(snapshot.features['forecast.history'].reason).toBe('not-entitled');
    expect(snapshot.features['forecast.history'].requiredPlan).toBe('network');
  });
});

describe('cache', () => {
  // Each test mints its own cache and hands it to its own engine: `hits()` is a
  // running total for the life of the cache, so anything reused between tests
  // would make the expected count depend on what ran before.
  it('reads through and serves subsequent checks from cache', async () => {
    const cache = createMemoryCache();
    const { engine } = build(cache);
    await engine.check(TENANT, 'alerts.webhook');
    await engine.check(TENANT, 'forecast.history');
    expect(cache.hits()).toBe(1);
  });

  it('serves STALE state until invalidated — hosts must call it on every write', async () => {
    const { engine, source } = build(createMemoryCache());
    expect((await engine.check(TENANT, 'forecast.history')).enabled).toBe(false);

    source.set(TENANT, { plan: PLANS.get('network').entitlements });
    expect((await engine.check(TENANT, 'forecast.history')).enabled).toBe(false); // stale

    await engine.invalidate(TENANT);
    expect((await engine.check(TENANT, 'forecast.history')).enabled).toBe(true);
  });

  it('recovers from a corrupt cache entry instead of failing every gate', async () => {
    const cache = createMemoryCache();
    const { engine } = build(cache);
    await cache.set('entitlements:' + TENANT, 'not json{');
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(true);
  });

  // The cache is an optimization over an authoritative source, so NO failure of
  // it may fail a gate. Each test below breaks exactly one of the three cache
  // calls; the entitlement answer must be identical to the uncached one.
  it('falls through to the source when the cache is unreachable on read', async () => {
    const cache = createMemoryCache();
    const dead: MemoryCache = {
      ...cache,
      get: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const { engine } = build(dead);
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(true);
  });

  it('still answers when evicting a corrupt entry itself fails', async () => {
    // The exact case the recovery path used to make worse: a poisoned entry
    // read back fine, then `del` rejects. Without a guard the gate would throw
    // for this tenant on every request until the TTL expired.
    const cache = createMemoryCache();
    await cache.set('entitlements:' + TENANT, 'not json{');
    const halfDead: MemoryCache = {
      ...cache,
      del: () => Promise.reject(new Error('READONLY')),
    };
    const { engine } = build(halfDead);
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(true);
  });

  it('still answers when the cache write fails', async () => {
    const cache = createMemoryCache();
    const unwritable: MemoryCache = {
      ...cache,
      set: () => Promise.reject(new Error('OOM')),
    };
    const { engine } = build(unwritable);
    expect((await engine.check(TENANT, 'alerts.webhook')).enabled).toBe(true);
  });
});
