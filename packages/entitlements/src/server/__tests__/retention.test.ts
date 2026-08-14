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
  'readings.retention_days': { kind: 'quota', onRevoke: 'readonly' },
  'archive.bin_days': { kind: 'quota', onRevoke: 'readonly' },
  'stations.online': { kind: 'quota', onRevoke: 'readonly' },
} as const);

const PLANS = definePlans(FEATURES, {
  free: {
    entitlements: {
      'readings.retention_days': 30,
      'archive.bin_days': 7,
      'stations.online': 20,
    },
  },
  max: {
    extends: 'free',
    entitlements: { 'readings.retention_days': 'unlimited' },
  },
} as const);

const RETENTION_FEATURES = ['readings.retention_days', 'archive.bin_days'];

const TENANT = 'client-1';
const FEATURE = 'readings.retention_days';
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
      retention.retentionWindowDays(TENANT, 'archive.bin_days'),
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
    // `stations.online` has a COUNT for usage; pruning by it would be
    // deleting a tenant's products. The type of mistake worth a throw.
    const { retention } = harness();
    await expect(retention.retentionWindowDays(TENANT, 'stations.online')).rejects.toThrow(
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

/**
 * The window gate — the asymmetry that made `prunableRange` a data-destruction
 * hazard.
 *
 * `retentionWindowDays` answers `null` — KEEP EVERYTHING — for any limit that
 * is not a positive number. `prunableRange` validated only the feature KEY, so
 * the same non-positive window it was handed became "delete everything": at
 * `windowDays: 0` the cutoff IS `now`, every watermark's `since` lies in the
 * past, `cutoff > since` passes, and the tenant's whole history comes back as
 * the prunable range.
 *
 * Each case asserts BOTH halves: the answer is `null`, AND no watermark row
 * was created or mutated. The second half is not a nicety — the old code wrote
 * the watermark before it computed the cutoff, so a bad window recorded itself
 * as the tenant's current window even on the calls that returned nothing, and
 * the next sweep at a good window then saw a "changed" window and reset
 * `since` again.
 */
describe('prunableRange refuses a window that is not a positive number of days', () => {
  const BAD_WINDOWS = [
    { label: 'zero — a full-history purge, never "prune nothing"', windowDays: 0 },
    { label: 'a negative window — the cutoff lands in the FUTURE', windowDays: -30 },
    { label: 'NaN — an Invalid Date compared its way to null by accident', windowDays: Number.NaN },
    { label: 'Infinity', windowDays: Number.POSITIVE_INFINITY },
  ];

  // A plain loop rather than `it.each`: the flakiness lint reads a binding
  // declared inside an `it.each` callback as describe-scoped, and then calls
  // the next plain test's use of the same name shared state.
  for (const { label, windowDays } of BAD_WINDOWS) {
    it(`answers null for ${label}, touching no watermark`, async () => {
      // A tenant in steady state with 400 days of history behind the
      // watermark: the case where a bad window destroys the most.
      const NOW = anchor();
      const since = new Date(NOW.getTime() - 400 * DAY);
      const { findUnique, create, update, retention } = harness();
      findUnique.mockResolvedValue({ windowDays: 30, since });

      await expect(retention.prunableRange(TENANT, FEATURE, windowDays, NOW)).resolves.toBeNull();

      // Refused before the row is even read, so nothing can be written from it.
      expect(findUnique).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it(`creates no first watermark for ${label} either`, async () => {
      // The other starting state: a tenant this sweep has never seen. The old
      // code took the `!existing` branch and CREATED a row recording the bad
      // window as the tenant's current one.
      const NOW = anchor();
      const { findUnique, create, update, retention } = harness();
      findUnique.mockResolvedValue(null);

      await expect(retention.prunableRange(TENANT, FEATURE, windowDays, NOW)).resolves.toBeNull();

      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  }

  it('still refuses a non-retention key before it looks at the window', async () => {
    // Gate order matters: a bad window on a key nothing should prune by is
    // still the louder mistake, and must keep throwing rather than quietly
    // answering `null`.
    const { retention } = harness();
    await expect(retention.prunableRange(TENANT, 'stations.online', 0, anchor())).rejects.toThrow(
      /not a retention quota/,
    );
  });

  it('hands back no range on the SECOND sweep at a persisted zero', async () => {
    // The destruction itself, and the reason the "no watermark written" half
    // of the cases above is load-bearing rather than tidy.
    //
    // Sweep one at `windowDays: 0` used to STORE `{ windowDays: 0, since: now }`
    // and answer null, which reads as harmless. Sweep two then finds a window
    // that has not "changed", keeps that stored `since`, and computes a cutoff
    // of `now` — so `cutoff > since` passes and the range handed back is every
    // row the tenant wrote in between. Nothing here is unreachable: a resolver
    // hiccup or a plan granting 0 days is all it takes to enter it.
    const NOW = anchor();
    const since = new Date(NOW.getTime() - 7 * DAY);
    const { findUnique, update, retention } = harness();
    findUnique.mockResolvedValue({ windowDays: 0, since });

    await expect(retention.prunableRange(TENANT, FEATURE, 0, NOW)).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('is the mirror of what the READ answers for the same window', async () => {
    // The pair that used to disagree, driven end to end through the engine: a
    // plan granting `0` days resolves to a limit of 0, which the read reports
    // as `null` — keep everything. The write half must now say the same thing
    // about the very window the read just refused to hand out.
    const NOW = anchor();
    const since = new Date(NOW.getTime() - 400 * DAY);
    const { findUnique, source, retention } = harness();
    source.set(TENANT, { plan: { 'readings.retention_days': 0 } });
    findUnique.mockResolvedValue({ windowDays: 0, since });

    await expect(retention.retentionWindowDays(TENANT, FEATURE)).resolves.toBeNull();
    await expect(retention.prunableRange(TENANT, FEATURE, 0, NOW)).resolves.toBeNull();
  });
});
