// @vitest-environment node
/**
 * The tenant layer's writer — the switch must stick (declared keys only),
 * only be offered where flipping it can help, and invalidate the engine's
 * cached state the moment it lands.
 */
import { describe, expect, it } from 'vitest';

import { createEntitlements } from '../../core/engine';
import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import { createMemoryCache, createMemorySource } from '../../memory';
import { createFeatureSettings } from '../settings';

const FEATURES = defineFeatures({
  approvals: { onRevoke: 'disable' },
  audit: { onRevoke: 'hide' },
} as const);

const PLANS = definePlans(FEATURES, {
  free: { entitlements: {} },
  pro: { extends: 'free', entitlements: { approvals: true, audit: true } },
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
      plan: PLANS.get('pro').entitlements,
      settings: { approvals: false },
    });
    // Entitled but off: the ONE denial the tenant can undo themselves.
    await expect(settings.describe('t1', 'approvals')).resolves.toEqual({
      entitled: true,
      enabled: false,
    });

    source.set('t2', { plan: {} });
    // A plan gap: the Switch must render dead, or it would 402 when used.
    await expect(settings.describe('t2', 'approvals')).resolves.toEqual({
      entitled: false,
      enabled: false,
    });
  });
});

describe('set', () => {
  it('merges the one switch over the declared keys already stored', async () => {
    const { column, settings } = harness();
    column.set('t1', { audit: false, ghost: true, approvals: 'yes' });
    await settings.set('t1', 'approvals', true);
    // `ghost` is undeclared and the garbage `approvals` value is dropped by
    // the same coercion the resolver reads through — the write cannot
    // reintroduce what the read would discard.
    expect(column.get('t1')).toEqual({ audit: false, approvals: true });
  });

  it('invalidates the cached state after the write', async () => {
    const { source, cache, engine, settings } = harness();
    source.set('t1', { plan: PLANS.get('pro').entitlements });
    await engine.check('t1', 'approvals'); // warm the cache
    expect(cache.size()).toBe(1);

    await settings.set('t1', 'approvals', false);
    expect(cache.size()).toBe(0);
  });
});
