import { describe, expect, it } from 'vitest';

import { resolveAll, resolveEntitlement } from '../core/resolve';
import { defineFeatures } from '../core/registry';
import { FEATURES, PLANS, type AppFeature } from './fixtures';

const hobby = PLANS.get('hobby').entitlements;
const network = PLANS.get('network').entitlements;

function resolve(feature: AppFeature, state: Parameters<typeof resolveEntitlement<AppFeature>>[2]) {
  return resolveEntitlement(feature, FEATURES, state, PLANS);
}

describe('layer 1 — code', () => {
  it('reports not-supported for an undeclared feature and offers no upsell', () => {
    const tiny = defineFeatures({ only: {} } as const);
    const decision = resolveEntitlement(
      'ghost' as 'only',
      tiny,
      { plan: { only: true } },
      null,
    );
    expect(decision).toMatchObject({
      enabled: false,
      reason: 'not-supported',
      requiredPlan: null,
    });
  });
});

describe('layer 2 — plan', () => {
  it('denies an ungranted feature and names the cheapest plan that has it', () => {
    const decision = resolve('forecast.history', { plan: hobby });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe('not-entitled');
    expect(decision.requiredPlan).toBe('network');
  });

  it('grants a feature the plan includes', () => {
    expect(resolve('alerts.webhook', { plan: PLANS.get('station').entitlements })).toMatchObject({
      enabled: true,
      reason: 'enabled',
      requiredPlan: null,
    });
  });

  it('surfaces the revoke policy even while denied, so hosts know what to do with existing rows', () => {
    expect(resolve('alerts.webhook', { plan: hobby }).policy).toBe('disable');
    expect(resolve('stations.online', { plan: {} }).policy).toBe('readonly');
    expect(resolve('forecast.history', { plan: hobby }).policy).toBe('hide');
  });

  it('lets an override grant a feature the plan lacks (comped tenant)', () => {
    const decision = resolve('forecast.history', { plan: hobby, overrides: { 'forecast.history': true } });
    expect(decision.enabled).toBe(true);
  });

  it('lets an override REVOKE a feature the plan grants', () => {
    const decision = resolve('forecast.history', { plan: network, overrides: { 'forecast.history': false } });
    expect(decision).toMatchObject({ enabled: false, reason: 'not-entitled' });
  });

  it('offers NO upsell when an override revoked a plan-granted feature', () => {
    // The tenant is on `network`, which grants it; the platform revoked it.
    // `cheapestWith('forecast.history')` would answer "network" — the plan they already pay
    // for — so an unguarded upsell renders "Upgrade to Pro" to a Pro tenant.
    // An override replaces the plan value, so no upgrade could lift it.
    const decision = resolve('forecast.history', { plan: network, overrides: { 'forecast.history': false } });
    expect(decision.requiredPlan).toBeNull();
  });

  it('offers no upsell when an override zeroes out a granted quota', () => {
    const decision = resolve('stations.online', {
      plan: network,
      overrides: { 'stations.online': 0 },
    });
    expect(decision).toMatchObject({
      enabled: false,
      reason: 'not-entitled',
      requiredPlan: null,
    });
  });

  it('still upsells when the denial is a genuine plan gap, not an override', () => {
    // Guards the fix above from over-reaching: an override on ANOTHER feature
    // must not suppress this feature's upsell.
    const decision = resolve('forecast.history', { plan: hobby, overrides: { 'alerts.webhook': true } });
    expect(decision.requiredPlan).toBe('network');
  });

  it('treats quota 0 as an explicit "none", not as "unset"', () => {
    const decision = resolve('stations.online', { plan: { 'stations.online': 0 } });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe('not-entitled');
  });

  it('carries the quota ceiling on the decision', () => {
    expect(resolve('stations.online', { plan: hobby }).limit).toBe(1);
    expect(resolve('stations.online', { plan: network }).limit).toBe('unlimited');
  });

  it('reports null limit for boolean features', () => {
    expect(resolve('forecast.history', { plan: network }).limit).toBeNull();
  });
});

describe('layer 3 — lifecycle status', () => {
  it('withholds a granted feature while restricted', () => {
    const decision = resolve('alerts.webhook', { plan: network, status: 'restricted' });
    expect(decision).toMatchObject({ enabled: false, reason: 'restricted' });
  });

  it('retains features flagged retainWhenRestricted', () => {
    expect(resolve('readings.read', { plan: network, status: 'restricted' }).enabled).toBe(
      true,
    );
  });

  it('suspends everything, including retained features', () => {
    expect(resolve('readings.read', { plan: network, status: 'suspended' })).toMatchObject({
      enabled: false,
      reason: 'suspended',
    });
  });

  it('never offers an upsell for a status denial — they already paid for it', () => {
    expect(resolve('alerts.webhook', { plan: network, status: 'restricted' }).requiredPlan).toBeNull();
    expect(resolve('alerts.webhook', { plan: network, status: 'suspended' }).requiredPlan).toBeNull();
  });

  it('denies on the PLAN before the status, so an unentitled feature still upsells', () => {
    const decision = resolve('forecast.history', { plan: hobby, status: 'restricted' });
    expect(decision.reason).toBe('not-entitled');
    expect(decision.requiredPlan).toBe('network');
  });
});

describe('layer 4 — tenant', () => {
  it('lets an entitled tenant switch a feature off', () => {
    const decision = resolve('alerts.webhook', { plan: network, settings: { 'alerts.webhook': false } });
    expect(decision).toMatchObject({
      enabled: false,
      reason: 'disabled-by-tenant',
      requiredPlan: null,
    });
  });

  it('honours defaultWhenEntitled=false until the tenant opts in', () => {
    expect(resolve('calibration.review', { plan: network }).reason).toBe('disabled-by-tenant');
    expect(resolve('calibration.review', { plan: network, settings: { 'calibration.review': true } }).enabled).toBe(
      true,
    );
  });

  it('cannot switch ON something the plan does not grant', () => {
    const decision = resolve('forecast.history', { plan: hobby, settings: { 'forecast.history': true } });
    expect(decision).toMatchObject({ enabled: false, reason: 'not-entitled' });
  });
});

describe('resolveAll', () => {
  it('returns a decision for every declared feature', () => {
    const all = resolveAll(FEATURES, { plan: hobby }, PLANS);
    expect(Object.keys(all).sort()).toEqual([...FEATURES.list].sort());
    expect(all['forecast.history'].enabled).toBe(false);
    expect(all['readings.read'].enabled).toBe(true);
  });
});
