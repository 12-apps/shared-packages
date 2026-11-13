/**
 * The NF-e per-item rounding: each tax of each item is rounded to whole cents
 * on its own, and a document total is the sum of its rounded items. The mode
 * is HALF-EVEN (ABNT NBR 5891), the official calculator's: R$ 5,00 × 0,9% =
 * 0,045 → 0,04 and R$ 25,00 × 0,9% = 0,225 → 0,22, recorded from the
 * calculator in `__tests__/fixtures/calculator/half-cent.*`. Never a floor.
 *
 * The reduction applies to the RATE (the layout's `pAliqEfet = pAliq × (1 −
 * pRedAliq)`), and the product is computed exactly in integers: cents × bp ×
 * bp needs up to 10^17 for a large order, past `Number.MAX_SAFE_INTEGER`, so
 * the arithmetic is BigInt and nothing is rounded before the end.
 */

const BP = 10_000n;
/** The denominator of an effective rate: bp × bp. */
const RATE_SCALE = BP * BP;

/** round_half_even(numerator / denominator) for a non-negative numerator. */
function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const twice = (numerator - quotient * denominator) * 2n;
  if (twice > denominator) return quotient + 1n;
  if (twice < denominator) return quotient;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/** The effective rate's numerator over `RATE_SCALE`: rateBp × (10⁴ − reductionBp). */
export function effectiveRate(rateBp: number, reductionBp: number): bigint {
  return BigInt(rateBp) * (BP - BigInt(reductionBp));
}

/** round_half_even(baseCents × rateBp/10⁴ × (1 − reductionBp/10⁴)), in cents. */
export function roundTaxCents(baseCents: number, rateBp: number, reductionBp: number): number {
  return Number(roundHalfEven(BigInt(baseCents) * effectiveRate(rateBp, reductionBp), RATE_SCALE));
}

function taxesOn(base: bigint, rates: readonly bigint[]): bigint[] {
  return rates.map((rate) => roundHalfEven(base * rate, RATE_SCALE));
}

/**
 * Take the taxes OUT of a tax-inclusive price. The base (`vBC`) is the
 * largest whole-cent amount whose own rounded taxes, added back, do not pass
 * the price — the exact `price / (1 + Σ rates)` or the cent below it. The
 * taxes are each rounded on that base (so `vBC × pAliqEfet` holds per tax),
 * and the net value (`vProdLiq`) is the
 * price less them, so `net + Σ taxes = price` to the cent.
 */
export function splitTaxInclusivePrice(
  priceCents: number,
  rates: readonly bigint[],
): { baseCents: number; taxCents: number[]; netCents: number } {
  const price = BigInt(priceCents);
  const total = rates.reduce((sum, rate) => sum + rate, 0n);
  // Three cents above the exact base: f(b) = b + Σ round(b × r) ≥ b(1 + r) − 1.5,
  // so from there f(b) is past the price and the walk down meets the answer.
  let base = (price * RATE_SCALE) / (RATE_SCALE + total) + 3n;
  let taxes = taxesOn(base, rates);
  while (base > 0n && base + taxes.reduce((sum, tax) => sum + tax, 0n) > price) {
    base -= 1n;
    taxes = taxesOn(base, rates);
  }
  const taxCents = taxes.map(Number);
  return { baseCents: Number(base), taxCents, netCents: priceCents - taxCents.reduce((sum, tax) => sum + tax, 0) };
}

/** Quantity with at most four decimals (`qCom`), as ten-thousandths. */
function quantityInTenThousandths(quantity: number): bigint {
  return BigInt(Math.round(quantity * 10_000));
}

/**
 * `vUnComLiq`: the net value per unit, in reais with ten decimals, rounded
 * half-even — far inside the ±0,01 the layout allows between it × `qCom` and
 * `vProdLiq` (rule I11c-20).
 */
export function netUnitValue(netCents: number, quantity: number): string {
  const scaled = roundHalfEven(BigInt(netCents) * 10n ** 12n, quantityInTenThousandths(quantity));
  const digits = scaled.toString().padStart(11, "0");
  return `${digits.slice(0, -10)}.${digits.slice(-10)}`;
}
