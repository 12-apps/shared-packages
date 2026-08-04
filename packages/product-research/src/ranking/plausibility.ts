import type { ScoredOffer } from '../types';

/**
 * The unit-price plausibility guard (FUT-497).
 *
 * A title is not the only place a pack size hides. Live run
 * 6d942a66-add9-45a2-91d1-bf62d9ed27da (tenant future-drink, "coca cola
 * 220ml") ranked "Refrigerante Coca Cola Zero Açúcar 220ml" at R$ 32,28 with
 * NO count anywhere in the title — the vendor's listing sells a 12-pack and
 * only the listing page says so. No parser can recover that, so the number we
 * show is a wrong per-unit price presented as a right one, which is exactly how
 * a comparison loses the buyer's trust.
 *
 * What CAN be said, cheaply and deterministically, is that the price is
 * implausible for a single unit: within one query's results, an offer that
 * claims one unit at many times the median unit price is almost certainly an
 * unparsed multipack. So flag it — never hide it, never re-order it:
 *
 * - Information beats silence, flagged (the FUT-491 doctrine): the offer keeps
 *   its price, its row and the rank the arithmetic gives it. It also needs no
 *   demotion — cheapest-first already sorts a suspiciously HIGH unit price to
 *   the bottom; the harm was the unqualified number, not its position.
 * - Derived, never stored: the flag is a pure function of the offer set, so
 *   the pipeline and the host's read path can both compute it (see
 *   `getResearchRun`) and a sharpened threshold re-labels historical runs
 *   instead of leaving a stale column behind.
 *
 * The two thresholds, against the numbers from that run (median unit price
 * R$ 2,90; the suspects at R$ 32,28 = 11.1x and R$ 39,83 = 13.7x):
 *
 * - `SUSPECT_UNIT_PRICE_MULTIPLE` = 6. The floor of the signal we are after is
 *   a mis-read SIX-pack (6x); genuine per-unit spread inside ONE search term
 *   stays far below that — the widest legitimate gap in the run above was a 2L
 *   bottle at ~3x the median can. 6 sits in that gap with room on both sides.
 * - `MIN_PLAUSIBILITY_SAMPLE` = 4. Three offers have no meaningful median (one
 *   multipack among three IS the median), so a small run flags nothing at all
 *   rather than guessing.
 *
 * Only `packQuantity === 1` offers are eligible: the hypothesis is "the pack
 * size was never read". An offer that DOES state its pack and is still 6x the
 * median is a genuinely expensive product, and calling that suspect would be
 * the false positive that makes the badge worthless.
 *
 * KNOWN LIMIT — the guard compares prices, not products. On a narrow term
 * ("coca cola 220ml", the run above) 6x is unreachable without a hidden pack.
 * On a broad one ("cerveja") a single imported 750ml among 350ml cans can clear
 * it honestly, and no arithmetic here can tell the two apart: the offer row
 * carries no comparable size — `unitVolumeMl` is parsed for the unit price and
 * then dropped, never persisted — so there is nothing to normalize by. That is
 * why the flag is advisory and its copy hedges ("pode ser um pacote … ou um
 * produto de tamanho maior") instead of asserting a cause, and why it neither
 * hides nor demotes the offer. Volume-normalizing it needs a persisted unit
 * volume on the offer row, which is a schema change of its own.
 */

/** The minimum an offer must expose to be judged — engine or persisted row. */
export interface UnitPriceCandidate {
  packQuantity: number;
  unitPriceCents: number;
}

/** Below this many offers a run flags nothing: no meaningful median. */
export const MIN_PLAUSIBILITY_SAMPLE = 4;

/** Multiple of the median unit price at which a single-unit claim is suspect. */
export const SUSPECT_UNIT_PRICE_MULTIPLE = 6;

/**
 * Median unit price across the run's offers, or null when the sample is too
 * small to have one. The MEDIAN (not the mean) so the very outliers this
 * guard hunts cannot drag the reference up and hide each other.
 */
export const medianUnitPriceCents = (offers: readonly UnitPriceCandidate[]): number | null => {
  const prices = offers
    .map((offer) => offer.unitPriceCents)
    .filter((cents) => cents > 0)
    .sort((a, b) => a - b);
  if (prices.length < MIN_PLAUSIBILITY_SAMPLE) return null;
  const middle = Math.floor(prices.length / 2);
  const upper = prices[middle] ?? 0;
  if (prices.length % 2 === 1) return upper;
  const lower = prices[middle - 1] ?? 0;
  return Math.round((lower + upper) / 2);
};

/**
 * One boolean per offer, in the SAME order — a parallel array rather than a
 * mapped object so the engine's `ScoredOffer` and the host's persisted row
 * shape can share the judgement without sharing a type.
 */
export const suspectUnitPriceFlags = (offers: readonly UnitPriceCandidate[]): boolean[] => {
  const median = medianUnitPriceCents(offers);
  if (median === null || median <= 0) return offers.map(() => false);
  const ceiling = median * SUSPECT_UNIT_PRICE_MULTIPLE;
  return offers.map((offer) => offer.packQuantity <= 1 && offer.unitPriceCents >= ceiling);
};

/** The ranked list with `suspectUnitPrice` set on the implausible offers. */
export const flagSuspectUnitPrices = (offers: readonly ScoredOffer[]): ScoredOffer[] => {
  const flags = suspectUnitPriceFlags(offers);
  return offers.map((offer, index) =>
    flags[index] === true ? { ...offer, suspectUnitPrice: true } : offer,
  );
};
