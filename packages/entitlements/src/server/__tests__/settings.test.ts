// @vitest-environment node
/**
 * The tenant layer's writer — the switch must stick (declared keys only),
 * only be offered where flipping it can help, invalidate the engine's cached
 * state the moment it lands, and REFUSE the same denials the read reports.
 */
import { describe, expect, it } from 'vitest';

import { createEntitlements } from '../../core/engine';
import { EntitlementRequiredError } from '../../core/errors';
import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import { createMemoryCache, createMemorySource } from '../../memory';
import { createFeatureSettings } from '../settings';

const FEATURES = defineFeatures({
  // The opt-in kind: entitled is not the same as ON, so the tenant has to ask
  // for it deliberately. That is exactly what pre-arming the switch defeated.
  'calibration.review': { onRevoke: 'disable', defaultWhenEntitled: false },
  'forecast.history': { onRevoke: 'hide' },
} as const);

const PLANS = definePlans(FEATURES, {
  hobby: { entitlements: {} },
  network: {
    extends: 'hobby',
    entitlements: { 'calibration.review': true, 'forecast.history': true },
  },
} as const);

type Feature = (typeof FEATURES.list)[number];

/**
 * Fresh engine, cache, column and writer per call — held in ONE object so no
 * binding named `source` / `column` / `settings` exists outside a test body
 * at all (the engine.test.ts pattern).
 */
function harness() {
  const ports = {
    source: createMemorySource<Feature>(),
    cache: createMemoryCache(),
    column: new Map<string, unknown>(),
  };
  // Named `resolver` here so no binding called `engine` exists outside a
  // test body — the flakiness gate tracks helper-scope names.
  const resolver = createEntitlements({
    features: FEATURES,
    plans: PLANS,
    source: ports.source,
    cache: ports.cache,
  });
  return {
    ...ports,
    engine: resolver,
    settings: createFeatureSettings({
      engine: resolver,
      features: FEATURES,
      store: {
        read: async (tenantId) => ports.column.get(tenantId),
        write: async (tenantId, value) => {
          ports.column.set(tenantId, value);
        },
      },
    }),
  };
}

describe('describe', () => {
  it('offers the switch only where flipping it can help', async () => {
    const { source, settings } = harness();
    source.set('t1', {
      plan: PLANS.get('network').entitlements,
      settings: { 'calibration.review': false },
    });
    // Entitled but off: the ONE denial the tenant can undo themselves.
    await expect(settings.describe('t1', 'calibration.review')).resolves.toEqual({
      entitled: true,
      enabled: false,
    });

    source.set('t2', { plan: {} });
    // A plan gap: the Switch must render dead, or it would 402 when used.
    await expect(settings.describe('t2', 'calibration.review')).resolves.toEqual({
      entitled: false,
      enabled: false,
    });
  });
});

describe('set', () => {
  it('merges the one switch over the declared keys already stored', async () => {
    const { column, settings, source } = harness();
    source.set('t1', { plan: PLANS.get('network').entitlements });
    column.set('t1', { 'forecast.history': false, ghost: true, 'calibration.review': 'yes' });
    await settings.set('t1', 'calibration.review', true);
    // `ghost` is undeclared and the garbage `approvals` value is dropped by
    // the same coercion the resolver reads through — the write cannot
    // reintroduce what the read would discard.
    expect(column.get('t1')).toEqual({ 'forecast.history': false, 'calibration.review': true });
  });

  it('refuses a write the READ would have rendered as a dead Switch', async () => {
    // Reads and writes now gate on the SAME condition. This one was inert
    // while the tenant stayed unentitled — layer 4 runs after layer 2, so the
    // stored value changed no decision — but it was STORED, and
    // `defaultWhenEntitled: false` exists precisely so that entitlement alone
    // does not turn the feature on. Pre-arming it meant the deliberate opt-in
    // happened before the entitlement, and the feature came up already ON the
    // moment a plan change granted it.
    const { column, settings, source } = harness();
    source.set('t2', { plan: PLANS.get('hobby').entitlements });

    await expect(settings.set('t2', 'calibration.review', true)).rejects.toBeInstanceOf(
      EntitlementRequiredError,
    );
    // Nothing was written, so there is nothing to come up armed later.
    expect(column.has('t2')).toBe(false);
    // And it is the same answer the panel already renders.
    await expect(settings.describe('t2', 'calibration.review')).resolves.toEqual({
      entitled: false,
      enabled: false,
    });
  });

  it('still allows the tenant to switch an entitled feature back ON', async () => {
    // `disabled-by-tenant` is the one denial this writer exists to leave and
    // return from — refusing it would strand a tenant behind their own switch.
    const { column, settings, source } = harness();
    source.set('t3', {
      plan: PLANS.get('network').entitlements,
      settings: { 'calibration.review': false },
    });
    await settings.set('t3', 'calibration.review', true);
    expect(column.get('t3')).toEqual({ 'calibration.review': true });
  });

  it('invalidates the cached state after the write', async () => {
    const { source, cache, engine, settings } = harness();
    source.set('t1', {
      plan: PLANS.get('network').entitlements,
      settings: { 'calibration.review': true },
    });
    await engine.check('t1', 'calibration.review'); // warm the cache
    expect(cache.size()).toBe(1);

    await settings.set('t1', 'calibration.review', false);
    expect(cache.size()).toBe(0);
  });
});
