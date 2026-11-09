// @vitest-environment node
/**
 * The `offered` predicate of `definePlans`: it narrows which plan an UPSELL
 * names, and nothing else. Every entitlement check keeps reading what the
 * tenant is granted, so a store left on a plan that is no longer sold is not
 * downgraded by it.
 */
import { describe, expect, it } from 'vitest';

import { createEntitlements } from '../core/engine';
import { QuotaExceededError } from '../core/errors';
import { definePlans } from '../core/plans';
import { defineFeatures } from '../core/registry';
import { createMemorySource, createMemoryUsage } from '../memory';
import { createPlanImpact } from '../server/plan-impact';
import { createPlanService } from '../server/plan-service';
import { EN_US_ENTITLEMENTS_MESSAGES } from '../server/en-US';

const FEATURES = defineFeatures({
  'base.read': {},
  'basic.export': {},
  'pro.api': {},
  seats: { kind: 'quota', onRevoke: 'readonly' },
} as const);

type Feature = (typeof FEATURES.list)[number];

const LADDER = {
  free: { entitlements: { 'base.read': true, seats: 1 } },
  basic: { extends: 'free', entitlements: { 'basic.export': true, seats: 5 } },
  pro: { extends: 'basic', entitlements: { 'pro.api': true, seats: 25 } },
  max: { extends: 'pro', entitlements: { seats: 'unlimited' } },
} as const;

const TENANT = 't1';

/** A live snapshot the predicate reads on every call, never at definition. */
function snapshot(...keys: string[]) {
  const live = new Set<string>(keys);
  return {
    offered: (key: string): boolean => live.has(key),
    offer: (key: string): void => void live.add(key),
    retire: (key: string): void => void live.delete(key),
  };
}

function ladder(offered?: (key: string) => boolean) {
  return offered === undefined
    ? definePlans(FEATURES, LADDER)
    : definePlans(FEATURES, LADDER, { offered });
}

function engineOn(
  planKey: 'free' | 'basic',
  offered?: (key: string) => boolean,
  seatsUsed = 0,
) {
  const plans = ladder(offered);
  const source = createMemorySource<Feature>();
  const usage = createMemoryUsage<Feature>();
  source.set(TENANT, { plan: plans.get(planKey).entitlements, planKey });
  usage.set(TENANT, 'seats', seatsUsed);
  return { plans, usage, engine: createEntitlements({ features: FEATURES, plans, source, usage }) };
}

describe('cheapestWith with an offered predicate', () => {
  const { offered } = snapshot('free', 'max');

  it('names the cheapest OFFERED plan for a basic-level feature', () => {
    expect(ladder(offered).cheapestWith('basic.export')?.key).toBe('max');
  });

  it('still names free for a free feature', () => {
    expect(ladder(offered).cheapestWith('base.read')?.key).toBe('free');
  });

  it('is unchanged without the option', () => {
    expect(ladder().cheapestWith('basic.export')?.key).toBe('basic');
    expect(ladder().cheapestWith('seats', 1)?.key).toBe('basic');
  });

  it('names an offered plan on the quota path', () => {
    expect(ladder(offered).cheapestWith('seats', 1)?.key).toBe('max');
    expect(ladder(offered).cheapestWith('seats', 5)?.key).toBe('max');
  });

  it('is evaluated on every call, not frozen at definePlans', () => {
    const sold = snapshot('free', 'max');
    expect(ladder(sold.offered).cheapestWith('basic.export')?.key).toBe('max');
    // One catalog, defined once, answering from the snapshot as it changes.
    const catalog = ladder(sold.offered);
    sold.offer('basic');
    expect(catalog.cheapestWith('basic.export')?.key).toBe('basic');
    sold.retire('basic');
    sold.retire('max');
    expect(catalog.cheapestWith('basic.export')).toBeNull();
  });

  it('returns null when nothing offered grants the feature', () => {
    // Same answer as "no plan grants it": the upsell has no target.
    expect(ladder(snapshot('free').offered).cheapestWith('pro.api')).toBeNull();
    expect(ladder(snapshot('free').offered).cheapestWith('seats', 1)).toBeNull();
    expect(ladder(() => false).cheapestWith('base.read')).toBeNull();
  });

  it('exposes isOffered, true for every plan without the option', () => {
    expect(ladder().isOffered?.('basic')).toBe(true);
    expect(ladder(offered).isOffered?.('basic')).toBe(false);
    expect(ladder(offered).isOffered?.('max')).toBe(true);
  });
});

describe('the engine and the plan view follow it', () => {
  const { offered } = snapshot('free', 'max');

  it('names an offered plan as requiredPlan on a denial', async () => {
    const { engine } = engineOn('free', offered);
    const decision = await engine.check(TENANT, 'basic.export');
    expect(decision.enabled).toBe(false);
    expect(decision.requiredPlan).toBe('max');
  });

  it('names basic today without the option', async () => {
    const { engine } = engineOn('free');
    expect((await engine.check(TENANT, 'basic.export')).requiredPlan).toBe('basic');
  });

  it('names an offered plan when a quota is spent', async () => {
    const { engine } = engineOn('free', offered, 1);
    const error = await engine.requireQuota(TENANT, 'seats').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError<Feature>).toPayload().requiredPlan).toBe('max');
  });

  it('feeds the plan view upsell and quota.nextPlan', async () => {
    const { plans, usage, engine } = engineOn('free', offered, 2);
    const service = createPlanService({
      engine,
      features: FEATURES,
      plans,
      usage,
      defaultPlanKey: 'free',
      pricing: [
        { key: 'free', name: 'Free', priceCents: 0 },
        { key: 'basic', name: 'Basic', priceCents: 100 },
        { key: 'max', name: 'Max', priceCents: 900 },
      ],
      formatPrice: (cents) => (cents === null ? null : `${cents}c`),
      messages: EN_US_ENTITLEMENTS_MESSAGES,
    });
    const view = await service.getPlanView(TENANT);
    const row = (feature: string) => view.features.find((f) => f.feature === feature);
    expect(row('basic.export')?.requiredPlan).toBe('max');
    // Holding 2 seats over a ceiling of 1: the over-quota row upsells via nextPlan.
    expect(row('seats')?.requiredPlan).toBe('max');
  });
});

describe('entitlement checks never read offered', () => {
  it('lets a store on a plan that is not offered pass every entitlement it has', async () => {
    const { engine } = engineOn('basic', snapshot('free', 'max').offered);
    expect((await engine.check(TENANT, 'base.read')).enabled).toBe(true);
    expect((await engine.check(TENANT, 'basic.export')).enabled).toBe(true);
    expect((await engine.checkQuota(TENANT, 'seats')).limit).toBe(5);
    await expect(engine.require(TENANT, 'basic.export')).resolves.toBeDefined();
    await expect(engine.requireQuota(TENANT, 'seats', 5)).resolves.toBeDefined();
    // And what it lacks still denies, upselling to an offered plan.
    expect((await engine.check(TENANT, 'pro.api')).requiredPlan).toBe('max');
  });

  it('grants identically with and without the predicate', async () => {
    const withOffered = engineOn('basic', () => false);
    const without = engineOn('basic');
    const grants = async (e: typeof without.engine) =>
      Object.values((await e.toSnapshot(TENANT)).features).map((d) => [
        d.feature,
        d.enabled,
        d.limit,
      ]);
    expect(await grants(withOffered.engine)).toEqual(await grants(without.engine));
  });
});

describe('cheapestTierFor honours the predicate', () => {
  function calc(offered?: (key: string) => boolean) {
    return createPlanImpact({
      plans: ladder(offered),
      defaultPlanKey: 'free',
      messages: EN_US_ENTITLEMENTS_MESSAGES,
      surfaces: { seats: { feature: 'seats', label: 'seats' } },
    });
  }

  it('skips tiers that are not offered', () => {
    expect(calc().cheapestTierFor({ seats: 3 })).toBe('basic');
    expect(calc(snapshot('free', 'max').offered).cheapestTierFor({ seats: 3 })).toBe('max');
    expect(calc(snapshot('free', 'max').offered).cheapestTierFor({ seats: 0 })).toBe('free');
  });

  it('returns null when no offered tier fits', () => {
    expect(calc(snapshot('free').offered).cheapestTierFor({ seats: 3 })).toBeNull();
  });
});
