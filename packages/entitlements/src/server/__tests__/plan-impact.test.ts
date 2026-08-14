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
  'stations.online': { kind: 'quota', onRevoke: 'readonly' },
  'alerts.digest': { onRevoke: 'disable' },
  'crew.seats': { kind: 'quota', onRevoke: 'readonly' },
} as const);

const PLANS = definePlans(FEATURES, {
  hobby: { entitlements: { 'stations.online': 20, 'alerts.digest': false, 'crew.seats': 1 } },
  network: {
    extends: 'hobby',
    entitlements: { 'stations.online': 'unlimited', 'alerts.digest': true, 'crew.seats': 10 },
  },
} as const);

/** A fresh calculator per test — the factory is pure, the lint wants locals. */
function calc() {
  return createPlanImpact({
    plans: PLANS,
    defaultPlanKey: 'hobby',
    surfaces: {
      stations: { feature: 'stations.online', label: 'estações' },
      digests: { feature: 'alerts.digest', label: 'resumos' },
      seats: { feature: 'crew.seats', label: 'operadores' },
    },
  });
}

describe('impactOf', () => {
  it('reports a vanished surface before a tightened ceiling, biggest overage first', () => {
    const violations = calc().impactOf({ stations: 25, digests: 14, seats: 3 }, 'hobby');
    expect(violations.map((v) => `${v.surface}:${v.kind}`)).toEqual([
      'digests:lost',
      'stations:capped',
      'seats:capped',
    ]);
    // "loses 14 resumos" is actionable in a way "loses digests" is not — and
    // the noun is the HOST's, which is why `surfaces` carries a label at all.
    expect(violations[0]).toMatchObject({ label: 'resumos', used: 14, allowed: 0 });
  });

  it('violates nothing on a tier whose ceilings clear the usage', () => {
    expect(calc().impactOf({ stations: 25, digests: 14, seats: 3 }, 'network')).toEqual([]);
  });
});

describe('cheapestTierFor', () => {
  it('walks the ladder in declaration order — the same order upsells use', () => {
    expect(calc().cheapestTierFor({ stations: 5, digests: 0, seats: 1 })).toBe('hobby');
    expect(calc().cheapestTierFor({ stations: 25, digests: 0, seats: 1 })).toBe('network');
  });

  it('answers null when even the top tier would cap them', () => {
    expect(calc().cheapestTierFor({ stations: 25, digests: 0, seats: 99 })).toBeNull();
  });

  it('starts a brand-new tenant at zero everywhere', () => {
    expect(calc().emptyUsage()).toEqual({ stations: 0, digests: 0, seats: 0 });
  });
});

describe('summarizeImpact — the three meanings of a plan key', () => {
  const losing = { hobby: [{}], network: [] } as Record<'hobby' | 'network', readonly unknown[]>;
  const safe = { hobby: [], network: [] } as Record<'hobby' | 'network', readonly unknown[]>;

  it('counts a loss against the tenant\'s OWN current tier', () => {
    const summary = calc().summarizeImpact([
      { currentPlanKey: 'hobby', planKeyFrom: 'assigned', recommendedTier: 'network', impactByTier: losing },
      { currentPlanKey: 'network', planKeyFrom: 'assigned', recommendedTier: 'network', impactByTier: losing },
    ]);
    // The first loses on hobby; the second's own tier (network) is clean.
    expect(summary.losingOnCurrent).toBe(1);
    expect(summary.byCurrent).toEqual({ hobby: 1, network: 1 });
  });

  it('scores an off-ladder CLIENT key against the default plan, and says so', () => {
    const summary = calc().summarizeImpact([
      { currentPlanKey: 'legacy', planKeyFrom: 'assigned', recommendedTier: null, impactByTier: losing },
    ]);
    expect(summary).toMatchObject({ offLadder: 1, losingOnCurrent: 1, unscorable: 0 });
    expect(calc().formatOffLadderNote(summary.offLadder, summary.total)).toContain('"hobby"');
  });

  it('refuses to score an off-ladder SUBSCRIPTION key in either direction', () => {
    // A live subscription's ceilings are its frozen snapshot, which the
    // catalog does not model — calling it hobby would invent losses, calling
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
    const line = calc().formatTierBreakdown({ hobby: 2, legacy: 1, none: 1 });
    // "no tier fits" names the ladder's OWN richest tier, read off the
    // catalog. It used to be hardcoded to one host's tier name, so every other
    // adopter's report cited a tier its catalog does not contain.
    expect(line).toBe('hobby 2, ⚠️ legacy 1, ⚠️ acima do network 1');
  });

  it('prints no caveat for a fleet with nothing to caveat', () => {
    expect(calc().formatOffLadderNote(0, 5)).toBeNull();
    expect(calc().formatUnscorableNote(0, 5)).toBeNull();
  });

  it('names no noun for what a tenant IS — one host said "loja", the next does not', () => {
    const off = calc().formatOffLadderNote(3, 12) ?? '';
    const unscorable = calc().formatUnscorableNote(2, 12) ?? '';
    expect(off).toContain('3/12');
    expect(unscorable).toContain('2/12');
    for (const note of [off, unscorable]) {
      expect(note).not.toContain('loja');
    }
  });
});

describe('the assembly check', () => {
  it('refuses an empty surface map rather than reporting a fleet it never measured', () => {
    // The empty-collection trap: with no surfaces every tier violates nothing,
    // so `cheapestTierFor` answers the CHEAPEST tier for everybody and
    // `losingOnCurrent` is zero — a green light to downgrade the whole fleet,
    // produced without measuring one of them.
    expect(() =>
      createPlanImpact({ plans: PLANS, defaultPlanKey: 'hobby', surfaces: {} }),
    ).toThrow(/`surfaces` is empty/);
  });

  it('refuses a default plan key the ladder does not declare', () => {
    expect(() =>
      createPlanImpact({
        plans: PLANS,
        defaultPlanKey: 'legacy' as 'hobby',
        surfaces: { stations: { feature: 'stations.online', label: 'estações' } },
      }),
    ).toThrow(/does not declare/);
  });
});
