// @vitest-environment node
/**
 * Retention watermarks — "downgrade never deletes", made mechanical.
 *
 * The invariant under test: a row is prunable only when it was written AFTER
 * the tenant's current window took effect AND has aged past it. Everything a
 * tenant accumulated under a longer entitlement stays.
 */
import { describe, expect, it, vi } from 'vitest';

import { createEntitlements } from '../../core/engine';
import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import { createMemorySource } from '../../memory';
import { createRetention, type RetentionWatermarkDb } from '../retention';

const FEATURES = defineFeatures({
  'audit.retention_days': { kind: 'quota', onRevoke: 'readonly' },
  'lifecycle.recycle_bin_days': { kind: 'quota', onRevoke: 'readonly' },
  'catalog.products': { kind: 'quota', onRevoke: 'readonly' },
} as const);

const PLANS = definePlans(FEATURES, {
  free: {
    entitlements: {
      'audit.retention_days': 30,
      'lifecycle.recycle_bin_days': 7,
      'catalog.products': 20,
    },
  },
  max: {
    extends: 'free',
    entitlements: { 'audit.retention_days': 'unlimited' },
  },
} as const);

const RETENTION_FEATURES = ['audit.retention_days', 'lifecycle.recycle_bin_days'];

const TENANT = 'client-1';
const FEATURE = 'audit.retention_days';
const DAY = 24 * 60 * 60 * 1000;
/** A fresh instant per test — a Date is mutable, and a shared module-level
 *  clock is exactly the order dependence the flakiness lint exists to catch. */
function anchor(): Date {
  return new Date('2026-07-30T12:00:00Z');
}

/**
 * Fresh mocks, source and module under test per call — held in ONE object so
 * no binding named `source` / `findUnique` / `retention` exists outside a
 * test body at all (the engine.test.ts pattern): there is then nothing for a
 * later edit to accidentally reach for and share.
 */
function harness(retentionFeatures: readonly string[] = RETENTION_FEATURES) {
  const ports = {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    source: createMemorySource<(typeof FEATURES.list)[number]>(),
  };
  const db: RetentionWatermarkDb = {
    retentionWatermark: {
      findUnique: ports.findUnique,
      create: ports.create,
      update: ports.update,
    },
  };
  return {
    ...ports,
    retention: createRetention({
      engine: createEntitlements({ features: FEATURES, plans: PLANS, source: ports.source }),
      features: FEATURES,
      retentionFeatures,
      getDb: () => db,
    }),
  };
}

describe('retentionWindowDays', () => {
  it("answers the tier's window", async () => {
    const { source, retention } = harness();
    source.set(TENANT, { plan: PLANS.get('free').entitlements });
    await expect(retention.retentionWindowDays(TENANT, FEATURE)).resolves.toBe(30);
    await expect(
      retention.retentionWindowDays(TENANT, 'lifecycle.recycle_bin_days'),
    ).resolves.toBe(7);
  });

  it('answers null — prune NOTHING — for an unlimited window or a withheld one', async () => {
    // The fail-safe direction: `unlimited` has no cutoff, and a suspended
    // tenant's history must be KEPT, not treated as retention zero.
    const { source, retention } = harness();
    source.set(TENANT, { plan: PLANS.get('max').entitlements });
    await expect(retention.retentionWindowDays(TENANT, FEATURE)).resolves.toBeNull();
    source.set(TENANT, { plan: PLANS.get('free').entitlements, status: 'suspended' });
    await expect(retention.retentionWindowDays(TENANT, FEATURE)).resolves.toBeNull();
  });

  it('refuses to answer for a feature that is not a retention quota', async () => {
    // `catalog.products` has a COUNT for usage; pruning by it would be
    // deleting a tenant's products. The type of mistake worth a throw.
    const { retention } = harness();
    await expect(retention.retentionWindowDays(TENANT, 'catalog.products')).rejects.toThrow(
      /not a retention quota/,
    );
  });

  it('answers null for a key this build does not declare', async () => {
    const { retention } = harness();
    await expect(
      retention.retentionWindowDays(TENANT, 'ghost.retention'),
    ).rejects.toThrow(/not a retention quota/);
    const withGhost = harness([...RETENTION_FEATURES, 'ghost.retention']);
    await expect(
      withGhost.retention.retentionWindowDays(TENANT, 'ghost.retention'),
    ).resolves.toBeNull();
  });
});

describe('prunableRange', () => {
  it('protects the whole backlog on first observation', async () => {
    // Before enforcement existed the tenant was effectively unlimited, so day
    // one prunes nothing: the watermark starts NOW and the window counts
    // forward from it.
    const NOW = anchor();
    const { findUnique, create, retention } = harness();
    findUnique.mockResolvedValue(null);

    await expect(retention.prunableRange(TENANT, FEATURE, 30, NOW)).resolves.toBeNull();

    expect(create).toHaveBeenCalledWith({
      data: { clientId: TENANT, feature: FEATURE, windowDays: 30, since: NOW },
    });
  });

  it('prunes the aged slice in steady state', async () => {
    const NOW = anchor();
    const since = new Date(NOW.getTime() - 100 * DAY);
    const { findUnique, update, retention } = harness();
    findUnique.mockResolvedValue({ windowDays: 30, since });

    const range = await retention.prunableRange(TENANT, FEATURE, 30, NOW);

    expect(range).toEqual({ since, cutoff: new Date(NOW.getTime() - 30 * DAY) });
    expect(update).not.toHaveBeenCalled();
  });

  it('does NOT retroactively destroy history when the window shrinks', async () => {
    // A year on a 90-day window, downgraded to 30. The 60 days the tenant
    // accumulated while entitled must survive; only history written from the
    // downgrade on gets the shorter life.
    const NOW = anchor();
    const since = new Date(NOW.getTime() - 400 * DAY);
    const { findUnique, update, retention } = harness();
    findUnique.mockResolvedValue({ windowDays: 90, since });

    await expect(retention.prunableRange(TENANT, FEATURE, 30, NOW)).resolves.toBeNull();

    expect(update).toHaveBeenCalledWith({
      where: { clientId_feature: { clientId: TENANT, feature: FEATURE } },
      data: { windowDays: 30, since: NOW },
    });
  });

  it('starts pruning again only once new history outlives the shrunk window', async () => {
    // 40 days after the downgrade to 30, the first 10 post-downgrade days are
    // prunable — and nothing older than the watermark is.
    const NOW = anchor();
    const since = new Date(NOW.getTime() - 40 * DAY);
    const { findUnique, retention } = harness();
    findUnique.mockResolvedValue({ windowDays: 30, since });

    const range = await retention.prunableRange(TENANT, FEATURE, 30, NOW);

    expect(range).toEqual({ since, cutoff: new Date(NOW.getTime() - 30 * DAY) });
  });

  it('resets the anchor on growth too — under-pruning is the safe wrong', async () => {
    const NOW = anchor();
    const since = new Date(NOW.getTime() - 400 * DAY);
    const { findUnique, update, retention } = harness();
    findUnique.mockResolvedValue({ windowDays: 30, since });

    await expect(retention.prunableRange(TENANT, FEATURE, 90, NOW)).resolves.toBeNull();

    expect(update).toHaveBeenCalledWith({
      where: { clientId_feature: { clientId: TENANT, feature: FEATURE } },
      data: { windowDays: 90, since: NOW },
    });
  });
});
