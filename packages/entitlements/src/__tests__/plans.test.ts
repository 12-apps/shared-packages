import { describe, expect, it } from 'vitest';

import { definePlans } from '../core/plans';
import { defineFeatures } from '../core/registry';
import { FEATURES, PLANS } from './fixtures';

describe('definePlans', () => {
  it('flattens extends chains into a single map', () => {
    const pro = PLANS.get('pro').entitlements;
    // inherited from basic, through plus
    expect(pro['orders.read']).toBe(true);
    // inherited from plus
    expect(pro.mcp).toBe(true);
    // own
    expect(pro.audit).toBe(true);
  });

  it('lets a richer tier override an inherited value in either direction', () => {
    expect(PLANS.get('basic').entitlements['stock.locations']).toBe(1);
    expect(PLANS.get('plus').entitlements['stock.locations']).toBe(5);
    expect(PLANS.get('pro').entitlements['stock.locations']).toBe('unlimited');

    const plans = definePlans(FEATURES, {
      a: { entitlements: { mcp: true } },
      b: { extends: 'a', entitlements: { mcp: false } },
    } as const);
    expect(plans.get('b').entitlements.mcp).toBe(false);
  });

  it('rejects a plan referencing an undeclared feature, naming the plan', () => {
    expect(() =>
      definePlans(FEATURES, {
        // @ts-expect-error — 'telepathy' is not in the registry
        oops: { entitlements: { telepathy: true } },
      } as const),
    ).toThrow(/Plan "oops" references undeclared feature "telepathy"/);
  });

  it('rejects a boolean on a quota feature, which would silently uncap it', () => {
    // `true` normalizes to an unbounded ceiling, so this typo would hand the
    // tenant unlimited locations rather than the number that was meant. Fails
    // at boot, where the catalog is authored.
    expect(() =>
      definePlans(FEATURES, {
        oops: { entitlements: { 'stock.locations': true } },
      } as const),
    ).toThrow(/quota feature "stock.locations" the boolean true/);
  });

  it('still accepts a number or unlimited on a quota feature', () => {
    expect(() =>
      definePlans(FEATURES, {
        ok: { entitlements: { 'stock.locations': 0 } },
        big: { entitlements: { 'stock.locations': 'unlimited' } },
      } as const),
    ).not.toThrow();
  });

  it('rejects a cyclic extends chain instead of hanging', () => {
    const features = defineFeatures({ x: {} } as const);
    expect(() =>
      definePlans(features, {
        a: { extends: 'b', entitlements: {} },
        b: { extends: 'a', entitlements: {} },
      } as const),
    ).toThrow(/Cyclic plan inheritance/);
  });

  it('throws on an unknown plan key', () => {
    expect(() => PLANS.get('enterprise' as 'pro')).toThrow(/Unknown plan/);
  });

  it('preserves declaration order as rank', () => {
    expect(PLANS.list).toEqual(['basic', 'plus', 'pro']);
    expect(PLANS.get('basic').rank).toBe(0);
    expect(PLANS.get('pro').rank).toBe(2);
  });
});

describe('cheapestWith — the upsell target', () => {
  it('returns the lowest-ranked plan granting a feature', () => {
    expect(PLANS.cheapestWith('mcp')?.key).toBe('plus');
    expect(PLANS.cheapestWith('audit')?.key).toBe('pro');
    expect(PLANS.cheapestWith('orders.read')?.key).toBe('basic');
  });

  it('returns null when no plan grants it', () => {
    const plans = definePlans(FEATURES, {
      free: { entitlements: {} },
    } as const);
    expect(plans.cheapestWith('audit')).toBeNull();
  });

  it('respects minLimit so a spent quota upsells past the current ceiling', () => {
    // A tenant already on 1 location must be offered plus (5), not basic (1).
    expect(PLANS.cheapestWith('stock.locations', 1)?.key).toBe('plus');
    // A tenant on 5 must be offered pro (unlimited).
    expect(PLANS.cheapestWith('stock.locations', 5)?.key).toBe('pro');
    // Nothing beats unlimited.
    expect(
      PLANS.cheapestWith('stock.locations', Number.POSITIVE_INFINITY),
    ).toBeNull();
  });
});
