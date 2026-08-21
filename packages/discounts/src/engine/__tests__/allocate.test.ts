import { describe, expect, it } from "vitest";

import { allocateByLargestRemainder, maxDiscountableCents, rawAmountCents } from "../allocate";
import { MIN_PAYABLE_TOTAL_CENTS } from "../kinds";
import { fixedRule, percentRule, rule } from "./fixtures";

/**
 * Unit (FUT-245): R5 (what one discount is worth against a base) and R7 (how
 * those cents are split across the covered lines). Table A of the plan.
 *
 * R7's contract is the one the COGS engine already lives by: the parts must
 * reconstitute the whole on an indivisible amount, so no cent is ever invented
 * or lost between `order.discount_total_cents` and `order_items.discount_cents`.
 */

/** Allocate over positional lines, so a case reads as `[34, 33, 33]`. */
function allocList(amountCents: number, remaining: readonly number[]): number[] {
  const keyed = new Map(remaining.map((cents, index) => [`line-${index}`, cents]));
  const allocation = allocateByLargestRemainder(amountCents, keyed);
  return remaining.map((_, index) => allocation.get(`line-${index}`) ?? -1);
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

describe("rawAmountCents (R5)", () => {
  it("A1: takes 10% of a 1000-cent base as 100 cents", () => {
    expect(rawAmountCents(percentRule(10, { id: "d1" }), 1_000)).toBe(100);
  });

  it("A2: floors 33,33% of 100 cents to 33, never rounding the buyer up to 34", () => {
    expect(rawAmountCents(rule({ id: "d2", percentOffBp: 3_333 }), 100)).toBe(33);
  });

  it("A3: takes the whole base at 100% off", () => {
    expect(rawAmountCents(rule({ id: "d3", percentOffBp: 10_000 }), 1_997)).toBe(1_997);
  });

  it("A4: computes 0 for a percentage too small to remove a whole cent", () => {
    expect(rawAmountCents(rule({ id: "d4", percentOffBp: 1 }), 99)).toBe(0);
  });

  it("A5: clamps a fixed amount larger than the base, never issuing a credit", () => {
    expect(rawAmountCents(fixedRule(5_000, { id: "d5" }), 1_200)).toBe(1_200);
  });

  it("A6: computes 0 for a fixed amount against an exhausted base", () => {
    expect(rawAmountCents(fixedRule(5_000, { id: "d6" }), 0)).toBe(0);
  });
});

describe("maxDiscountableCents (R9)", () => {
  it("keeps one payable cent back from a chargeable gross", () => {
    expect(maxDiscountableCents(1_000)).toBe(1_000 - MIN_PAYABLE_TOTAL_CENTS);
    expect(maxDiscountableCents(2)).toBe(1);
  });

  it("allows nothing at all when the gross is already the floor", () => {
    expect(maxDiscountableCents(MIN_PAYABLE_TOTAL_CENTS)).toBe(0);
  });

  it("returns zero — never a negative — for a cart that is already free", () => {
    // The floor caps discounts; it must not invent a cent on an empty or
    // free-items-only cart, or `totalCents` would exceed `subtotalCents`.
    expect(maxDiscountableCents(0)).toBe(0);
    expect(maxDiscountableCents(-5)).toBe(0);
  });
});

describe("allocateByLargestRemainder (R7)", () => {
  it("A7: splits an indivisible 100 over three equal lines as 34/33/33", () => {
    expect(allocList(100, [100, 100, 100])).toEqual([34, 33, 33]);
  });

  it("A8: gives a single leftover cent to the first line on a full tie", () => {
    expect(allocList(1, [500, 500])).toEqual([1, 0]);
  });

  it("A9: reconciles 999 over 1000/1/1 without overshooting any line", () => {
    const allocation = allocList(999, [1_000, 1, 1]);
    expect(total(allocation)).toBe(999);
    expect(allocation).toEqual([997, 1, 1]);
  });

  it("A10: puts the whole amount on a lone covered line", () => {
    expect(allocList(437, [10_000])).toEqual([437]);
  });

  it("A11: allocates nothing when the amount is zero", () => {
    expect(allocList(0, [100, 250])).toEqual([0, 0]);
  });

  it("A11: allocates nothing when every covered line is already exhausted", () => {
    expect(allocList(50, [0, 0])).toEqual([0, 0]);
  });
});

/**
 * A12 — the property-style sweep. Hand-written rather than generated: the
 * flakiness gate bans random data in tests, and a fixed table is also a
 * regression corpus a future change has to keep passing.
 */
const ALLOCATION_TUPLES: [number, number[]][] = [
  [0, [0]],
  [1, [1]],
  [1, [1, 1]],
  [1, [2, 1]],
  [2, [1, 1]],
  [2, [3, 3, 3]],
  [3, [3, 3, 3]],
  [5, [3, 3, 3]],
  [9, [3, 3, 3]],
  [100, [100, 100, 100]],
  [101, [100, 100, 100]],
  [299, [100, 100, 100]],
  [300, [100, 100, 100]],
  [7, [10, 20, 30]],
  [13, [10, 20, 30]],
  [59, [10, 20, 30]],
  [60, [10, 20, 30]],
  [999, [1_000, 1, 1]],
  [1_001, [1_000, 1, 1]],
  [1_002, [1_000, 1, 1]],
  [333, [999]],
  [1, [999, 1]],
  [500, [999, 1]],
  [1_000, [999, 1]],
  [17, [5, 5, 5, 5, 5]],
  [23, [5, 5, 5, 5, 5]],
  [25, [5, 5, 5, 5, 5]],
  [1, [7, 11, 13, 17]],
  [24, [7, 11, 13, 17]],
  [47, [7, 11, 13, 17]],
  [48, [7, 11, 13, 17]],
  [1_234, [4_321, 1_234, 999]],
  [6_554, [4_321, 1_234, 999]],
  [1, [0, 5]],
  [5, [0, 5]],
  [4, [1, 1, 1, 1, 1, 1, 1]],
  [6, [1, 1, 1, 1, 1, 1, 1]],
  [199, [200, 0, 0]],
  [12_345, [10_000, 2_345]],
  [2_997, [1_999, 999, 1]],
];

describe("allocateByLargestRemainder invariants (A12)", () => {
  it.each(ALLOCATION_TUPLES)(
    "allocates %i across %j summing exactly and never over a line's remainder",
    (amountCents, remaining) => {
      const allocation = allocList(amountCents, remaining);
      expect(total(allocation)).toBe(amountCents);
      expect(allocation.every((cents, index) => cents <= (remaining[index] ?? 0))).toBe(true);
      expect(allocation.every((cents) => cents >= 0)).toBe(true);
    },
  );
});
