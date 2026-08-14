import { describe, expect, it } from 'vitest';

import { definePlans } from '../core/plans';
import { defineFeatures } from '../core/registry';
import { FEATURES, PLANS } from './fixtures';

describe('definePlans', () => {
  it('flattens extends chains into a single map', () => {
    const network = PLANS.get('network').entitlements;
    // inherited from hobby, through station
    expect(network['readings.read']).toBe(true);
    // inherited from station
    expect(network['alerts.webhook']).toBe(true);
    // own
    expect(network['forecast.history']).toBe(true);
  });

  it('lets a richer tier override an inherited value in either direction', () => {
    expect(PLANS.get('hobby').entitlements['stations.online']).toBe(1);
    expect(PLANS.get('station').entitlements['stations.online']).toBe(5);
    expect(PLANS.get('network').entitlements['stations.online']).toBe('unlimited');

    const plans = definePlans(FEATURES, {
      a: { entitlements: { 'alerts.webhook': true } },
      b: { extends: 'a', entitlements: { 'alerts.webhook': false } },
    } as const);
    expect(plans.get('b').entitlements['alerts.webhook']).toBe(false);
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
        oops: { entitlements: { 'stations.online': true } },
      } as const),
    ).toThrow(/quota feature "stations.online" the boolean true/);
  });

  it('still accepts a number or unlimited on a quota feature', () => {
    expect(() =>
      definePlans(FEATURES, {
        ok: { entitlements: { 'stations.online': 0 } },
        big: { entitlements: { 'stations.online': 'unlimited' } },
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
    expect(() => PLANS.get('enterprise' as 'network')).toThrow(/Unknown plan/);
  });

  it('preserves declaration order as rank', () => {
    expect(PLANS.list).toEqual(['hobby', 'station', 'network']);
    expect(PLANS.get('hobby').rank).toBe(0);
    expect(PLANS.get('network').rank).toBe(2);
  });
});

describe('cheapestWith — the upsell target', () => {
  it('returns the lowest-ranked plan granting a feature', () => {
    expect(PLANS.cheapestWith('alerts.webhook')?.key).toBe('station');
    expect(PLANS.cheapestWith('forecast.history')?.key).toBe('network');
    expect(PLANS.cheapestWith('readings.read')?.key).toBe('hobby');
  });

  it('returns null when no plan grants it', () => {
    const plans = definePlans(FEATURES, {
      free: { entitlements: {} },
    } as const);
    expect(plans.cheapestWith('forecast.history')).toBeNull();
  });

  it('respects minLimit so a spent quota upsells past the current ceiling', () => {
    // A tenant already on 1 station must be offered station (5), not hobby (1).
    expect(PLANS.cheapestWith('stations.online', 1)?.key).toBe('station');
    // A tenant on 5 must be offered network (unlimited).
    expect(PLANS.cheapestWith('stations.online', 5)?.key).toBe('network');
    // Nothing beats unlimited.
    expect(
      PLANS.cheapestWith('stations.online', Number.POSITIVE_INFINITY),
    ).toBeNull();
  });
});
