import type { ScoredOffer } from '../types';

/**
 * Cheapest-first on the realizable per-unit cost for the requested quantity:
 * whole packs only (nobody buys 5/12 of a fardo), shipping amortized across
 * the units actually bought — so a cheap unit price with heavy freight or an
 * oversized pack cannot masquerade as the best deal. Ties break on
 * deliverability first — an offer priced for a region the store does not
 * deliver to (FUT-491) loses a TIE to an in-area one — then on ETA (unknown
 * ETA sorts after a known one). No pinning, no weighting, and no demotion: an
 * out-of-area offer with the cheapest unit price still ranks first, flagged.
 * The rank the buyer sees is the arithmetic.
 *
 * A COST HERE CAN BE A FLOOR (FUT-518). `shippingCents` is a tri-state and an
 * offer whose source never stated freight contributes 0 for it, so its cost is
 * the MINIMUM it could realize, not a price. That bias is reduced, not removed:
 * such an offer can still outrank one that honestly declared freight. The fix
 * is a caveat, not a thumb on the scale — see the note on the tiebreak below.
 *
 * A SECOND SITE DEPENDS ON THIS ORDER (FUT-519). `getResearchRun` in
 * apps/web/lib/repositories/research.ts reads a run's rows with
 * `orderBy: [rank asc NULLS LAST, totalCents asc]`, and a RUNNING run's rows
 * are still unranked — so `totalCents asc` alone must land them where this
 * function eventually would, or the partial view would re-sort itself at
 * completion. It does, because `effectiveUnitCents` is `round(totalCents /
 * units)` for a fixed quantity: a monotone transform, hence order-preserving.
 * Adding a WEIGHTING here (anything not derived from `totalCents`) silently
 * breaks that correspondence — change the read's ordering in the same commit.
 */
export const effectiveUnitCents = (offer: ScoredOffer, quantity: number): number => {
  const units = Math.max(quantity, 1);
  const packsNeeded = Math.ceil(units / Math.max(offer.packQuantity, 1));
  // `?? 0` is the FLOOR, deliberately, and it is the SAME expression
  // `score-offers.ts` wrote into `totalCents` — the two must stay identical or
  // the monotone-transform claim above stops holding (FUT-518/FUT-519).
  const total = packsNeeded * offer.priceCents + (offer.shippingCents ?? 0);
  return Math.round(total / units);
};

/** 1 for an out-of-area offer, 0 otherwise — the tiebreak's sort key. */
const outOfAreaKey = (offer: ScoredOffer): number => (offer.outsideDeliveryArea === true ? 1 : 0);

/**
 * NO shipping-known tiebreak here, and that is a decision, not an omission
 * (FUT-518). "At an equal floor, prefer the offer whose total is FINAL" reads
 * reasonable and was designed in; it was dropped for two reasons.
 *
 * 1. It would break the FUT-519 correspondence documented above. `getResearchRun`
 *    orders a RUNNING run's unranked rows by `totalCents` alone; whether a
 *    source stated freight is not a function of `totalCents`, so rows would
 *    re-shuffle under the buyer's cursor the moment the run completed. Making
 *    the read reproduce it is not available either: `shipping_cents ASC NULLS
 *    LAST` would ALSO reorder two known-shipping offers by freight amount, which
 *    this function does not do — a second divergence bought to close the first.
 * 2. It would be a SOURCE bias wearing a quality badge. `serp.ts`, `vtex.ts` and
 *    `manual.ts` state shipping never, `amazon.ts` and `mercado-livre.ts`
 *    sometimes — so the key would systematically demote whole connectors at
 *    equal cost, decided by which parser happened to read a string.
 *
 * The unknown is surfaced instead of scored, which is the FUT-491/FUT-497
 * doctrine this file already follows: flag it, never demote it. The caveat rides
 * the total on every surface (`shipping-unknown-badge.tsx`).
 */
export const rankOffers = (offers: ScoredOffer[], quantity: number): ScoredOffer[] => {
  const ranked = [...offers].sort((a, b) => {
    const byCost = effectiveUnitCents(a, quantity) - effectiveUnitCents(b, quantity);
    if (byCost !== 0) return byCost;
    const byArea = outOfAreaKey(a) - outOfAreaKey(b);
    if (byArea !== 0) return byArea;
    const aEta = a.etaDays ?? Number.MAX_SAFE_INTEGER;
    const bEta = b.etaDays ?? Number.MAX_SAFE_INTEGER;
    return aEta - bEta;
  });
  return ranked.map((offer, index) => ({ ...offer, rank: index + 1 }));
};
