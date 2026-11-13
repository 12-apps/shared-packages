/**
 * The NF-e layout's per-item rounding: each tax of each item is rounded to two
 * decimals (whole cents) on its own, and a document total is the sum of its
 * rounded items. Never the floor of a rate (a floor under-states the tax on
 * every line it touches, and the layout's ±0,01 tolerance does not absorb a
 * systematic cent). Half a cent rounds UP.
 *
 * The reduction applies to the RATE (the layout's `pAliqEfet = pAliq × (1 −
 * pRedAliq)`), and the product is computed exactly in integers: cents × bp ×
 * bp needs up to 10^17 for a large order, past `Number.MAX_SAFE_INTEGER`, so
 * the arithmetic is BigInt and nothing is rounded before the end.
 */

const BP = 10_000n;
const DENOMINATOR = BP * BP;

/** round_half_up(baseCents × rateBp/10⁴ × (1 − reductionBp/10⁴)), in cents. */
export function roundTaxCents(baseCents: number, rateBp: number, reductionBp: number): number {
  const numerator = BigInt(baseCents) * BigInt(rateBp) * (BP - BigInt(reductionBp));
  return Number((numerator * 2n + DENOMINATOR) / (DENOMINATOR * 2n));
}
