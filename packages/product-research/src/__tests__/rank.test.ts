import { describe, expect, it } from 'vitest';
import { effectiveUnitCents, rankOffers } from '../ranking/rank';
import type { ScoredOffer } from '../types';

const offer = (overrides: Partial<ScoredOffer>): ScoredOffer => ({
  sourceId: 's1',
  sourceType: 'VTEX',
  supplierName: 'Loja',
  title: 'Produto',
  currency: 'BRL',
  priceCents: 359,
  shippingCents: 0,
  packQuantity: 1,
  unitPriceCents: 359,
  totalCents: 359,
  relevanceScore: 1,
  ...overrides,
});

describe('rankOffers', () => {
  it('ranks a 12-pack and a single can as equals when unit prices match', () => {
    const single = offer({ supplierName: 'A', priceCents: 359, unitPriceCents: 359 });
    const pack = offer({
      supplierName: 'B',
      priceCents: 4308,
      packQuantity: 12,
      unitPriceCents: 359,
    });
    expect(effectiveUnitCents(single, 12)).toBe(effectiveUnitCents(pack, 12));
  });

  it('charges whole packs: an oversized fardo loses for a small quantity', () => {
    const fardo = offer({
      supplierName: 'fardo',
      priceCents: 4200,
      packQuantity: 12,
      unitPriceCents: 350,
    });
    const single = offer({ supplierName: 'single', priceCents: 380, unitPriceCents: 380 });
    expect(effectiveUnitCents(fardo, 5)).toBe(840);
    const ranked = rankOffers([fardo, single], 5);
    expect(ranked[0]?.supplierName).toBe('single');
  });

  it('sorts by effective unit cost ascending, shipping amortized', () => {
    const cheapUnitHeavyFreight = offer({
      supplierName: 'freight',
      priceCents: 300,
      unitPriceCents: 300,
      shippingCents: 2000,
    });
    const fairUnitFreeFreight = offer({
      supplierName: 'free',
      priceCents: 340,
      unitPriceCents: 340,
    });
    const ranked = rankOffers([cheapUnitHeavyFreight, fairUnitFreeFreight], 10);
    expect(ranked[0]?.supplierName).toBe('free');
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it('breaks a price TIE toward the in-area offer (FUT-491)', () => {
    const outOfArea = offer({ supplierName: 'outra região', outsideDeliveryArea: true });
    const inArea = offer({ supplierName: 'entrega aqui' });
    const ranked = rankOffers([outOfArea, inArea], 1);
    expect(ranked.map((entry) => entry.supplierName)).toEqual(['entrega aqui', 'outra região']);
  });

  it('never demotes a CHEAPER out-of-area offer — flagged, not hidden (FUT-491)', () => {
    const cheapOutOfArea = offer({
      supplierName: 'outra região',
      priceCents: 300,
      unitPriceCents: 300,
      outsideDeliveryArea: true,
    });
    const inArea = offer({ supplierName: 'entrega aqui', priceCents: 359, unitPriceCents: 359 });
    const ranked = rankOffers([inArea, cheapOutOfArea], 1);
    expect(ranked[0]?.supplierName).toBe('outra região');
    expect(ranked[0]?.rank).toBe(1);
  });

  it('floors an UNKNOWN shipping cost at zero, explicitly (FUT-518)', () => {
    // The tri-state's arithmetic contract: "the source never said" costs the
    // same as "the source said free" — a FLOOR, not an estimate. Pinned so a
    // future ticket that decides to guess freight has to delete this line.
    const unknown = offer({ shippingCents: undefined });
    const statedFree = offer({ shippingCents: 0 });
    expect(effectiveUnitCents(unknown, 12)).toBe(effectiveUnitCents(statedFree, 12));
    expect(effectiveUnitCents(unknown, 12)).toBe(effectiveUnitCents(offer({}), 12));
  });

  it('never demotes a CHEAPER unknown-shipping offer — flagged, not hidden (FUT-518)', () => {
    const cheapUnknownFreight = offer({
      supplierName: 'frete não informado',
      priceCents: 300,
      unitPriceCents: 300,
      shippingCents: undefined,
    });
    const statedFree = offer({ supplierName: 'frete grátis', priceCents: 359, unitPriceCents: 359 });
    const ranked = rankOffers([statedFree, cheapUnknownFreight], 1);
    expect(ranked[0]?.supplierName).toBe('frete não informado');
    expect(ranked[0]?.rank).toBe(1);
  });

  /**
   * THE GUARD FOR THE TIEBREAK THAT IS NOT HERE (FUT-518, and it protects
   * FUT-519). A "known shipping wins the tie" sort key was designed in and
   * rejected: it is not a function of `totalCents`, so `getResearchRun`'s
   * `totalCents asc` read of a RUNNING run's unranked rows could not reproduce
   * it, and the partial view would re-sort itself at completion. `rank.ts`
   * records the full reasoning. This asserts the absence executably — add the
   * key and this flips.
   */
  it('does NOT reorder a cost tie by whether shipping is known (FUT-519 read order)', () => {
    // Identical realizable cost, identical area, identical (absent) ETA: the
    // only difference is the tri-state, so a stable sort must keep input order.
    const unknown = offer({ supplierName: 'frete não informado', shippingCents: undefined });
    const known = offer({ supplierName: 'frete grátis', shippingCents: 0 });

    expect(rankOffers([unknown, known], 1).map((entry) => entry.supplierName)).toEqual([
      'frete não informado',
      'frete grátis',
    ]);
    expect(rankOffers([known, unknown], 1).map((entry) => entry.supplierName)).toEqual([
      'frete grátis',
      'frete não informado',
    ]);
  });

  it('breaks price ties by ETA, unknown ETA last', () => {
    const slow = offer({ supplierName: 'slow', etaDays: 5 });
    const fast = offer({ supplierName: 'fast', etaDays: 1 });
    const unknown = offer({ supplierName: 'unknown' });
    const ranked = rankOffers([unknown, slow, fast], 1);
    expect(ranked.map((entry) => entry.supplierName)).toEqual(['fast', 'slow', 'unknown']);
  });
});
