import { describe, expect, it } from 'vitest';
import {
  flagSuspectUnitPrices,
  medianUnitPriceCents,
  MIN_PLAUSIBILITY_SAMPLE,
  SUSPECT_UNIT_PRICE_MULTIPLE,
  suspectUnitPriceFlags,
} from '../ranking/plausibility';
import type { ScoredOffer } from '../types';

/**
 * FUT-497 part two: the guard for the offer whose pack size never reaches us.
 * The thresholds are the contract here — a run too small to have a median must
 * flag nothing, and a genuinely expensive product must not be called a lie.
 */

const candidate = (unitPriceCents: number, packQuantity = 1) => ({
  unitPriceCents,
  packQuantity,
});

/** ~The live run: seven offers around 290 cents plus the 3228-cent suspect. */
const LIVE_RUN = [
  candidate(332, 12),
  candidate(3228),
  candidate(290),
  candidate(279),
  candidate(290, 6),
  candidate(290, 12),
  candidate(279, 12),
  candidate(290, 2),
];

const scored = (unitPriceCents: number, packQuantity: number): ScoredOffer => ({
  sourceId: 'serp-1',
  sourceType: 'SERP',
  supplierName: 'Loja',
  title: `oferta ${unitPriceCents}`,
  currency: 'BRL',
  priceCents: unitPriceCents * packQuantity,
  shippingCents: 0,
  packQuantity,
  unitPriceCents,
  totalCents: unitPriceCents * packQuantity,
  relevanceScore: 0.97,
});

describe('medianUnitPriceCents', () => {
  it('is the median of the run — the outliers cannot drag it up', () => {
    expect(medianUnitPriceCents(LIVE_RUN)).toBe(290);
  });

  it('averages the middle pair on an even sample', () => {
    expect(medianUnitPriceCents([candidate(100), candidate(200), candidate(300), candidate(500)])).toBe(
      250,
    );
  });

  it('has no median below the minimum sample', () => {
    expect(MIN_PLAUSIBILITY_SAMPLE).toBe(4);
    expect(medianUnitPriceCents([])).toBeNull();
    expect(medianUnitPriceCents([candidate(3228)])).toBeNull();
    expect(medianUnitPriceCents([candidate(290), candidate(3228)])).toBeNull();
    expect(medianUnitPriceCents([candidate(290), candidate(279), candidate(3228)])).toBeNull();
  });
});

describe('suspectUnitPriceFlags', () => {
  it('flags only the one-unit claim priced like a whole multipack', () => {
    expect(suspectUnitPriceFlags(LIVE_RUN)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('does nothing on a run of one to three offers', () => {
    // One multipack among three IS the median — there is nothing to compare to.
    const tiny = [candidate(290), candidate(279), candidate(3228)];
    expect(suspectUnitPriceFlags(tiny)).toEqual([false, false, false]);
    expect(suspectUnitPriceFlags([])).toEqual([]);
  });

  it('spares a genuinely premium product a few times the median', () => {
    expect(SUSPECT_UNIT_PRICE_MULTIPLE).toBe(6);
    // The widest legitimate spread in the live run: a 2L bottle at ~3x a can.
    const withPremium = [candidate(290), candidate(279), candidate(299), candidate(899)];
    expect(suspectUnitPriceFlags(withPremium)).toEqual([false, false, false, false]);
  });

  it('fires exactly at the multiple, not before it', () => {
    const base = [candidate(100), candidate(100), candidate(100), candidate(100)];
    expect(suspectUnitPriceFlags([...base, candidate(599)]).at(-1)).toBe(false);
    expect(suspectUnitPriceFlags([...base, candidate(600)]).at(-1)).toBe(true);
  });

  it('never suspects an offer that states its own pack size', () => {
    // A stated 12-pack at 20x the median is an expensive product, not a lie.
    const base = [candidate(100), candidate(100), candidate(100), candidate(100)];
    expect(suspectUnitPriceFlags([...base, candidate(2000, 12)]).at(-1)).toBe(false);
  });

  it('ignores non-positive unit prices when taking the median', () => {
    const withZero = [candidate(0), candidate(100), candidate(100), candidate(100), candidate(100)];
    expect(medianUnitPriceCents(withZero)).toBe(100);
    expect(suspectUnitPriceFlags(withZero)).toEqual([false, false, false, false, false]);
  });
});

describe('flagSuspectUnitPrices', () => {
  it('adds the flag without touching the rank or any other field', () => {
    const offers = [
      { ...scored(290, 1), rank: 1 },
      { ...scored(279, 1), rank: 2 },
      { ...scored(299, 1), rank: 3 },
      { ...scored(3228, 1), rank: 4 },
    ];

    const flagged = flagSuspectUnitPrices(offers);

    expect(flagged.map((offer) => offer.rank)).toEqual([1, 2, 3, 4]);
    expect(flagged.map((offer) => offer.suspectUnitPrice)).toEqual([
      undefined,
      undefined,
      undefined,
      true,
    ]);
    // Nothing is dropped and nothing is re-ordered: the price still shows.
    expect(flagged.map((offer) => offer.unitPriceCents)).toEqual([290, 279, 299, 3228]);
  });

  it('leaves a small run completely untouched', () => {
    const offers = [{ ...scored(290, 1), rank: 1 }, { ...scored(3228, 1), rank: 2 }];

    expect(flagSuspectUnitPrices(offers)).toEqual(offers);
  });
});
