// @vitest-environment node
/**
 * The catalog-only impact calculator — the evidence a grandfathering decision
 * is made on. Ceilings are DERIVED from the plan catalog through the engine's
 * own normalization, so a boolean `false` is a ceiling of zero and a `true`
 * or `"unlimited"` never violates.
 */
import { describe, expect, it } from 'vitest';

import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import { createPlanImpact } from '../plan-impact';

const FEATURES = defineFeatures({
  'catalog.products': { kind: 'quota', onRevoke: 'readonly' },
  suppliers: { onRevoke: 'disable' },
  'team.seats': { kind: 'quota', onRevoke: 'readonly' },
} as const);

const PLANS = definePlans(FEATURES, {
  free: { entitlements: { 'catalog.products': 20, suppliers: false, 'team.seats': 1 } },
  pro: {
    extends: 'free',
    entitlements: { 'catalog.products': 'unlimited', suppliers: true, 'team.seats': 10 },
  },
} as const);

/** A fresh calculator per test — the factory is pure, the lint wants locals. */
function calc() {
  return createPlanImpact({
    plans: PLANS,
    defaultPlanKey: 'free',
    surfaces: {
      products: { feature: 'catalog.products', label: 'produtos' },
      suppliers: { feature: 'suppliers', label: 'fornecedores' },
      seats: { feature: 'team.seats', label: 'assentos' },
    },
  });
}

describe('impactOf', () => {
  it('reports a vanished surface before a tightened ceiling, biggest overage first', () => {
    const violations = calc().impactOf({ products: 25, suppliers: 14, seats: 3 }, 'free');
    expect(violations.map((v) => `${v.surface}:${v.kind}`)).toEqual([
      'suppliers:lost',
      'products:capped',
      'seats:capped',
    ]);
    // "loses 14 fornecedores" is actionable in a way "loses suppliers" is not.
    expect(violations[0]).toMatchObject({ label: 'fornecedores', used: 14, allowed: 0 });
  });

  it('violates nothing on a tier whose ceilings clear the usage', () => {
    expect(calc().impactOf({ products: 25, suppliers: 14, seats: 3 }, 'pro')).toEqual([]);
  });
});

describe('cheapestTierFor', () => {
  it('walks the ladder in declaration order — the same order upsells use', () => {
    expect(calc().cheapestTierFor({ products: 5, suppliers: 0, seats: 1 })).toBe('free');
    expect(calc().cheapestTierFor({ products: 25, suppliers: 0, seats: 1 })).toBe('pro');
  });

  it('answers null when even the top tier would cap them', () => {
    expect(calc().cheapestTierFor({ products: 25, suppliers: 0, seats: 99 })).toBeNull();
  });

  it('starts a brand-new tenant at zero everywhere', () => {
    expect(calc().emptyUsage()).toEqual({ products: 0, suppliers: 0, seats: 0 });
  });
});

describe('summarizeImpact — the three meanings of a plan key', () => {
  const losing = { free: [{}], pro: [] } as Record<'free' | 'pro', readonly unknown[]>;
  const safe = { free: [], pro: [] } as Record<'free' | 'pro', readonly unknown[]>;

  it('counts a loss against the tenant\'s OWN current tier', () => {
    const summary = calc().summarizeImpact([
      { currentPlanKey: 'free', planKeyFrom: 'assigned', recommendedTier: 'pro', impactByTier: losing },
      { currentPlanKey: 'pro', planKeyFrom: 'assigned', recommendedTier: 'pro', impactByTier: losing },
    ]);
    // The first loses on free; the second's own tier (pro) is clean.
    expect(summary.losingOnCurrent).toBe(1);
    expect(summary.byCurrent).toEqual({ free: 1, pro: 1 });
  });

  it('scores an off-ladder CLIENT key against the default plan, and says so', () => {
    const summary = calc().summarizeImpact([
      { currentPlanKey: 'legacy', planKeyFrom: 'assigned', recommendedTier: null, impactByTier: losing },
    ]);
    expect(summary).toMatchObject({ offLadder: 1, losingOnCurrent: 1, unscorable: 0 });
    expect(calc().formatOffLadderNote(summary.offLadder, summary.total)).toContain('"free"');
  });

  it('refuses to score an off-ladder SUBSCRIPTION key in either direction', () => {
    // A live subscription's ceilings are its frozen snapshot, which the
    // catalog does not model — calling it free would invent losses, calling
    // it safe would hide them.
    const summary = calc().summarizeImpact([
      {
        currentPlanKey: 'legacy',
        planKeyFrom: 'snapshot',
        recommendedTier: null,
        impactByTier: safe,
      },
    ]);
    expect(summary).toMatchObject({ offLadder: 0, losingOnCurrent: 0, unscorable: 1 });
    expect(calc().formatUnscorableNote(summary.unscorable, summary.total)).toContain('FORA');
  });

  it('renders unknown keys flagged rather than silently dropped', () => {
    const line = calc().formatTierBreakdown({ free: 2, legacy: 1, none: 1 });
    expect(line).toBe('free 2, ⚠️ legacy 1, ⚠️ acima do Max 1');
  });

  it('prints no caveat for a fleet with nothing to caveat', () => {
    expect(calc().formatOffLadderNote(0, 5)).toBeNull();
    expect(calc().formatUnscorableNote(0, 5)).toBeNull();
  });
});
