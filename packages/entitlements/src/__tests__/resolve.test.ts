import { describe, expect, it } from 'vitest';

import { resolveAll, resolveEntitlement } from '../core/resolve';
import { defineFeatures } from '../core/registry';
import { FEATURES, PLANS, type AppFeature } from './fixtures';

const basic = PLANS.get('basic').entitlements;
const pro = PLANS.get('pro').entitlements;

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
    const decision = resolve('audit', { plan: basic });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe('not-entitled');
    expect(decision.requiredPlan).toBe('pro');
  });

  it('grants a feature the plan includes', () => {
    expect(resolve('mcp', { plan: PLANS.get('plus').entitlements })).toMatchObject({
      enabled: true,
      reason: 'enabled',
      requiredPlan: null,
    });
  });

  it('surfaces the revoke policy even while denied, so hosts know what to do with existing rows', () => {
    expect(resolve('mcp', { plan: basic }).policy).toBe('disable');
    expect(resolve('stock.locations', { plan: {} }).policy).toBe('readonly');
    expect(resolve('audit', { plan: basic }).policy).toBe('hide');
  });

  it('lets an override grant a feature the plan lacks (comped tenant)', () => {
    const decision = resolve('audit', { plan: basic, overrides: { audit: true } });
    expect(decision.enabled).toBe(true);
  });

  it('lets an override REVOKE a feature the plan grants', () => {
    const decision = resolve('audit', { plan: pro, overrides: { audit: false } });
    expect(decision).toMatchObject({ enabled: false, reason: 'not-entitled' });
  });

  it('offers NO upsell when an override revoked a plan-granted feature', () => {
    // The tenant is on `pro`, which grants audit; the platform revoked it.
    // `cheapestWith('audit')` would answer "pro" — the plan they already pay
    // for — so an unguarded upsell renders "Upgrade to Pro" to a Pro tenant.
    // An override replaces the plan value, so no upgrade could lift it.
    const decision = resolve('audit', { plan: pro, overrides: { audit: false } });
    expect(decision.requiredPlan).toBeNull();
  });

  it('offers no upsell when an override zeroes out a granted quota', () => {
    const decision = resolve('stock.locations', {
      plan: pro,
      overrides: { 'stock.locations': 0 },
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
    const decision = resolve('audit', { plan: basic, overrides: { mcp: true } });
    expect(decision.requiredPlan).toBe('pro');
  });

  it('treats quota 0 as an explicit "none", not as "unset"', () => {
    const decision = resolve('stock.locations', { plan: { 'stock.locations': 0 } });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe('not-entitled');
  });

  it('carries the quota ceiling on the decision', () => {
    expect(resolve('stock.locations', { plan: basic }).limit).toBe(1);
    expect(resolve('stock.locations', { plan: pro }).limit).toBe('unlimited');
  });

  it('reports null limit for boolean features', () => {
    expect(resolve('audit', { plan: pro }).limit).toBeNull();
  });
});

describe('layer 3 — lifecycle status', () => {
  it('withholds a granted feature while restricted', () => {
    const decision = resolve('mcp', { plan: pro, status: 'restricted' });
    expect(decision).toMatchObject({ enabled: false, reason: 'restricted' });
  });

  it('retains features flagged retainWhenRestricted', () => {
    expect(resolve('orders.read', { plan: pro, status: 'restricted' }).enabled).toBe(
      true,
    );
  });

  it('suspends everything, including retained features', () => {
    expect(resolve('orders.read', { plan: pro, status: 'suspended' })).toMatchObject({
      enabled: false,
      reason: 'suspended',
    });
  });

  it('never offers an upsell for a status denial — they already paid for it', () => {
    expect(resolve('mcp', { plan: pro, status: 'restricted' }).requiredPlan).toBeNull();
    expect(resolve('mcp', { plan: pro, status: 'suspended' }).requiredPlan).toBeNull();
  });

  it('denies on the PLAN before the status, so an unentitled feature still upsells', () => {
    const decision = resolve('audit', { plan: basic, status: 'restricted' });
    expect(decision.reason).toBe('not-entitled');
    expect(decision.requiredPlan).toBe('pro');
  });
});

describe('layer 4 — tenant', () => {
  it('lets an entitled tenant switch a feature off', () => {
    const decision = resolve('mcp', { plan: pro, settings: { mcp: false } });
    expect(decision).toMatchObject({
      enabled: false,
      reason: 'disabled-by-tenant',
      requiredPlan: null,
    });
  });

  it('honours defaultWhenEntitled=false until the tenant opts in', () => {
    expect(resolve('approvals', { plan: pro }).reason).toBe('disabled-by-tenant');
    expect(resolve('approvals', { plan: pro, settings: { approvals: true } }).enabled).toBe(
      true,
    );
  });

  it('cannot switch ON something the plan does not grant', () => {
    const decision = resolve('audit', { plan: basic, settings: { audit: true } });
    expect(decision).toMatchObject({ enabled: false, reason: 'not-entitled' });
  });
});

describe('resolveAll', () => {
  it('returns a decision for every declared feature', () => {
    const all = resolveAll(FEATURES, { plan: basic }, PLANS);
    expect(Object.keys(all).sort()).toEqual([...FEATURES.list].sort());
    expect(all.audit.enabled).toBe(false);
    expect(all['orders.read'].enabled).toBe(true);
  });
});
