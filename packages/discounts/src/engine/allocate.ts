import { MAX_PERCENT_OFF_BP, MIN_PAYABLE_TOTAL_CENTS } from "./kinds";
import type { DiscountRule } from "./types";

/**
 * MONEY side of the discount evaluator (FUT-245): rules R5 (how many cents one
 * discount is worth against a base) and R7 (how those cents are split across
 * the lines it covers), from the numbered rule set in `./evaluate.ts`.
 *
 * Everything here is integer cents. The single float division lives in the
 * largest-remainder method and is bounded — both operands are well under 2^31,
 * so `amount * remaining` never leaves the exactly-representable integer range
 * and the fraction is only ever used as a SORT KEY, never as money.
 *
 * Kept in its own module because it is the part a reviewer wants to read (and
 * a test wants to drive) on its own, without a cart around it.
 */

/**
 * R5 — the raw value of one discount against a base.
 *
 * `PERCENTAGE` FLOORS: the house absorbs the sub-cent, never the buyer's total
 * drifting negative. `FIXED_AMOUNT` is clamped to the base, so "R$ 20 off" on a
 * base of R$ 12 removes R$ 12 and never issues a credit. A result of 0 means
 * the discount must NOT be applied — an `R$ 0,00` line is not a promotion.
 *
 * The two COMBO reward types return 0 here, and that is deliberate rather than
 * a gap: `BUNDLE_PRICE` and `FREE_UNITS` are not functions of a base at all.
 * One needs to know which UNITS the combo matched (the cheapest of them are the
 * free ones) and the other needs to know how many TIMES it matched, and a
 * single `baseCents` has thrown both facts away. `applicationReward` in
 * `./combo-match.ts` is where they are computed, per application, and it calls
 * back into this function for the two types that ARE a function of a base.
 *
 * Returning 0 rather than throwing keeps the failure the safe one: a combo
 * reward that somehow reached this path removes nothing, which the evaluator
 * reports as `ZERO_VALUE`, instead of a wrong number reaching a charge.
 */
export function rawAmountCents(rule: DiscountRule, baseCents: number): number {
  if (baseCents <= 0) return 0;
  if (rule.type === "PERCENTAGE") {
    const raw = Math.floor((baseCents * (rule.percentOffBp ?? 0)) / MAX_PERCENT_OFF_BP);
    return Math.max(0, Math.min(raw, baseCents));
  }
  if (rule.type === "FIXED_AMOUNT") {
    return Math.max(0, Math.min(rule.amountOffCents ?? 0, baseCents));
  }
  return 0;
}

/**
 * R9 — the most that may ever be taken off a gross amount: everything above
 * `MIN_PAYABLE_TOTAL_CENTS`, because an order the provider cannot charge is
 * worse for the buyer than an order that costs one cent more (see the constant's
 * own prose for the payment-path reason).
 *
 * A gross of zero returns zero, not a negative number: an empty cart, or one
 * holding only free items, stays at zero and simply gets no discount. The floor
 * caps what a promotion may remove; it never manufactures a total out of
 * nothing, and it can never push a total ABOVE its own subtotal.
 *
 * This is the ONE place the floor becomes a number. The evaluator measures its
 * per-application headroom against it (`./evaluate-passes.ts`), the final total
 * is re-clamped with it (`./evaluate.ts`) and the menu badge caps its previewed
 * price with it (`./preview.ts`) — three surfaces, one rule, so a card can never
 * advertise a price the cart would refuse to honour.
 */
export function maxDiscountableCents(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.max(0, grossCents - MIN_PAYABLE_TOTAL_CENTS);
}

interface AllocationPart {
  lineId: string;
  /** Position in the input map — the last, stable tie-break. */
  index: number;
  remainingCents: number;
  flooredCents: number;
  /** `exact - floor`, a sort key only. */
  fraction: number;
}

function toParts(
  amountCents: number,
  entries: readonly (readonly [string, number])[],
  baseTotalCents: number,
): AllocationPart[] {
  return entries.map(([lineId, remainingCents], index) => {
    const exact = (amountCents * remainingCents) / baseTotalCents;
    const flooredCents = Math.floor(exact);
    return { lineId, index, remainingCents, flooredCents, fraction: exact - flooredCents };
  });
}

/** Largest remainder first, then the bigger line, then input order. */
function compareParts(a: AllocationPart, b: AllocationPart): number {
  if (a.fraction !== b.fraction) return b.fraction - a.fraction;
  if (a.remainingCents !== b.remainingCents) return b.remainingCents - a.remainingCents;
  return a.index - b.index;
}

/**
 * The invariant this whole module exists for: the parts must reconstitute the
 * whole. A leak here would show up as an order whose `discount_total_cents`
 * disagrees with the sum of its `order_items.discount_cents`, which is exactly
 * the reconciliation the COGS engine already refuses to let drift.
 */
function assertAllocationSums(
  allocation: ReadonlyMap<string, number>,
  amountCents: number,
): void {
  let total = 0;
  for (const cents of allocation.values()) total += cents;
  if (total !== amountCents) {
    throw new Error(`Discount allocation summed to ${total}, expected ${amountCents}`);
  }
}

/**
 * R7 — split `amountCents` across the covered lines in proportion to what is
 * still discountable on each of them, by the LARGEST-REMAINDER method: floor
 * every share, then hand the leftover cents one at a time to the lines with the
 * biggest discarded fraction. The parts therefore sum to `amountCents` exactly,
 * with no per-line rounding leak, and no line is ever allocated more than it had
 * remaining (a line's exact share can only reach its remaining when the discount
 * takes the whole base, in which case there is no leftover cent to hand out).
 *
 * A base of zero — every covered line already fully discounted, or free — gives
 * an all-zero allocation; R5 has already turned that case into a rejection.
 */
export function allocateByLargestRemainder(
  amountCents: number,
  remaining: ReadonlyMap<string, number>,
): Map<string, number> {
  const entries = [...remaining.entries()];
  const allocation = new Map<string, number>(entries.map(([lineId]) => [lineId, 0]));
  const baseTotalCents = entries.reduce((sum, [, cents]) => sum + cents, 0);
  if (amountCents <= 0 || baseTotalCents <= 0) return allocation;

  const parts = toParts(amountCents, entries, baseTotalCents);
  let deficit = amountCents - parts.reduce((sum, part) => sum + part.flooredCents, 0);
  for (const part of [...parts].sort(compareParts)) {
    const bonus = deficit > 0 ? 1 : 0;
    deficit -= bonus;
    allocation.set(part.lineId, part.flooredCents + bonus);
  }
  assertAllocationSums(allocation, amountCents);
  return allocation;
}
