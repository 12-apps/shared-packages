import { describe, expect, it } from "vitest";

import { MIN_PAYABLE_TOTAL_CENTS } from "../kinds";
import { evaluateDiscounts } from "../evaluate";
import type { DiscountEvaluation, DiscountRule } from "../types";
import {
  NOW,
  appliedIds,
  at,
  evaluateCart,
  expectMoneyInvariant,
  fixedRule,
  line,
  percentRule,
  reasonFor,
  rule,
} from "./fixtures";

/**
 * Unit (FUT-245): precedence (R6), clamping (R5/R9) and the double-entry
 * invariant (R7). Table C of the plan, minus the stacking cases, which live in
 * ./evaluate-stacking.test.ts so neither file approaches the size gate.
 *
 * C15 and C16 no longer match the written spec, on purpose — see the R9 block in
 * ../evaluate.ts. A discounted order stops one cent above zero because the
 * payment provider refuses a R$ 0,00 charge.
 */

const ITEM_LINE = line({ lineId: "l1", menuItemId: "m1", categoryPath: ["c1"] });

describe("scope precedence (R6)", () => {
  it("C1: computes an order-wide percentage on what an item discount already left", () => {
    const result = evaluateCart({
      lines: [ITEM_LINE],
      rules: [
        percentRule(10, { id: "order-10" }),
        percentRule(50, { id: "item-50", scope: "ITEM", targetMenuItemIds: ["m1"] }),
      ],
    });
    expect(appliedIds(result)).toEqual(["item-50", "order-10"]);
    expect(result.discountTotalCents).toBe(550);
    expect(result.totalCents).toBe(450);
    expectMoneyInvariant(result);
  });

  it("C2: runs the three passes narrowest-first, ITEM then CATEGORY then ORDER", () => {
    const result = evaluateCart({
      lines: [ITEM_LINE],
      rules: [
        percentRule(10, { id: "order-10" }),
        percentRule(20, { id: "cat-20", scope: "CATEGORY", targetCategoryIds: ["c1"] }),
        percentRule(30, { id: "item-30", scope: "ITEM", targetMenuItemIds: ["m1"] }),
      ],
    });
    expect(appliedIds(result)).toEqual(["item-30", "cat-20", "order-10"]);
    expect(result.discountTotalCents).toBe(300 + 140 + 56);
    expectMoneyInvariant(result);
  });

  it("C3: makes a second item discount compute on the remainder, never on the gross", () => {
    const result = evaluateCart({
      lines: [ITEM_LINE],
      rules: [
        percentRule(50, { id: "half", scope: "ITEM", targetMenuItemIds: ["m1"] }),
        percentRule(10, { id: "tenth", scope: "ITEM", targetMenuItemIds: ["m1"] }),
      ],
    });
    expect(appliedIds(result)).toEqual(["half", "tenth"]);
    expect(result.applied.map((entry) => entry.amountCents)).toEqual([500, 50]);
    expectMoneyInvariant(result);
  });

  it("C4: clamps an order-wide fixed amount to what the cart still owes", () => {
    const result = evaluateCart({
      lines: [line({ lineId: "l1", menuItemId: "m1", unitPriceCents: 2_000 })],
      rules: [
        percentRule(40, { id: "item-40", scope: "ITEM", targetMenuItemIds: ["m1"] }),
        fixedRule(2_000, { id: "order-2000" }),
      ],
    });
    // 1_200 was still owed, but R9 keeps the last cent payable, so the order-wide
    // R$ 20,00 removes 1_199 of it.
    expect(result.applied.map((entry) => entry.amountCents)).toEqual([800, 1_199]);
    expect(result.totalCents).toBe(1);
    expectMoneyInvariant(result);
  });
});

describe("within-pass ordering (R6)", () => {
  it("C5: applies the bigger saving first", () => {
    const result = evaluateCart({
      rules: [fixedRule(300, { id: "small" }), fixedRule(500, { id: "big" })],
    });
    expect(appliedIds(result)).toEqual(["big", "small"]);
    expectMoneyInvariant(result);
  });

  it("C6: breaks an amount tie by age, oldest first", () => {
    const result = evaluateCart({
      rules: [
        fixedRule(300, { id: "younger", createdAt: new Date("2026-02-02T00:00:00.000Z") }),
        fixedRule(300, { id: "older", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      ],
    });
    expect(appliedIds(result)).toEqual(["older", "younger"]);
  });

  it("C7: breaks an amount and age tie by the lower id", () => {
    const result = evaluateCart({
      rules: [fixedRule(300, { id: "b-rule" }), fixedRule(300, { id: "a-rule" })],
    });
    expect(appliedIds(result)).toEqual(["a-rule", "b-rule"]);
  });
});

/**
 * R9, as the PRODUCT OWNER redefined it — deliberately NOT as the FUT-235 spec
 * wrote it. The spec's C15/C16 demanded a total of exactly 0; the payment path
 * cannot raise a R$ 0,00 charge, so a discounted order now stops one cent short.
 * These cases are the regression fence around that decision: if they ever start
 * expecting 0 again, someone has restored a stranded-order bug.
 */
describe("the payable floor (R9)", () => {
  it("C15: leaves one payable cent at 100% off, instead of landing on zero", () => {
    const result = evaluateCart({ rules: [percentRule(100, { id: "all" })] });
    expect(result.discountTotalCents).toBe(result.subtotalCents - MIN_PAYABLE_TOTAL_CENTS);
    expect(result.totalCents).toBe(MIN_PAYABLE_TOTAL_CENTS);
    expectMoneyInvariant(result);
  });

  it("C16: clamps an absurd fixed amount to the cart's subtotal minus the floor", () => {
    const result = evaluateCart({
      lines: [line({ lineId: "l1", unitPriceCents: 500 })],
      rules: [fixedRule(999_999, { id: "huge" })],
    });
    expect(result.discountTotalCents).toBe(499);
    expect(result.totalCents).toBe(1);
    expectMoneyInvariant(result);
  });

  it("refuses a 100% coupon outright when the cart is worth a single cent", () => {
    // Headroom is 1 - 1 = 0: there is nothing to give away that would still
    // leave a chargeable order, so the coupon is not applied at all rather than
    // applied for R$ 0,00.
    const result = evaluateCart({
      lines: [line({ lineId: "l1", unitPriceCents: 1 })],
      rules: [percentRule(100, { id: "all", trigger: "CODE", code: "CUPOM" })],
      couponCode: "CUPOM",
    });
    expect(result.applied).toEqual([]);
    expect(result.discountTotalCents).toBe(0);
    expect(result.totalCents).toBe(1);
    expect(reasonFor(result, "all")).toBe("ZERO_VALUE");
    expectMoneyInvariant(result);
  });

  it("never manufactures a cent out of a cart that is already free", () => {
    // The floor CAPS discounts; it does not invent money. A gross of zero stays
    // zero, and `totalCents` may never exceed `subtotalCents`.
    const result = evaluateCart({
      lines: [line({ lineId: "l1", unitPriceCents: 0 }), line({ lineId: "l2", unitPriceCents: 0 })],
      rules: [percentRule(100, { id: "all" })],
    });
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.applied).toEqual([]);
    expectMoneyInvariant(result);
  });

  it("clamps the SECOND of two stackable discounts to the headroom that is left", () => {
    // 800 + 400 = 1200 asked for against a 1000-cent cart: the first takes its
    // full 800, the second is capped to 1000 - 800 - 1 = 199, and the three
    // views of the money still agree to the cent.
    const result = evaluateCart({
      rules: [fixedRule(800, { id: "big" }), fixedRule(400, { id: "small" })],
    });
    expect(appliedIds(result)).toEqual(["big", "small"]);
    expect(result.applied.map((entry) => entry.amountCents)).toEqual([800, 199]);
    expect(result.discountTotalCents).toBe(999);
    expect(result.totalCents).toBe(1);
    expectMoneyInvariant(result);
  });

  it("still allocates a headroom-clamped discount across every line it covers", () => {
    // The clamp happens BEFORE the largest-remainder split, so 999 cents — not
    // the 1000 the rule asked for — is what gets divided over the three lines,
    // and the parts reconstitute it exactly.
    const result = evaluateCart({
      lines: [
        line({ lineId: "l1", unitPriceCents: 333 }),
        line({ lineId: "l2", unitPriceCents: 334 }),
        line({ lineId: "l3", unitPriceCents: 333 }),
      ],
      rules: [fixedRule(5_000, { id: "everything" })],
    });
    expect(result.discountTotalCents).toBe(999);
    expect(result.totalCents).toBe(1);
    expect(result.lines.map((entry) => entry.discountCents)).toEqual([333, 333, 333]);
    expect(result.lines.every((entry) => entry.discountCents > 0)).toBe(true);
    expectMoneyInvariant(result);
  });
});

describe("degenerate carts and rule sets", () => {
  it("C17: returns a zero evaluation for an empty cart, and tells the coupon why", () => {
    const result = evaluateDiscounts({
      lines: [],
      rules: [rule({ id: "d1", trigger: "CODE", code: "CUPOM" })],
      couponCode: "CUPOM",
      now: NOW,
    });
    expect(result).toEqual({
      subtotalCents: 0,
      discountTotalCents: 0,
      totalCents: 0,
      applied: [],
      lines: [],
      rejections: [{ discountId: null, code: "CUPOM", reason: "EMPTY_CART" }],
    });
  });

  it("C18: refuses a discount whose only covered line has no quantity", () => {
    const result = evaluateCart({
      lines: [line({ lineId: "l1", menuItemId: "m1", quantity: 0 })],
      rules: [
        rule({ id: "d1", trigger: "CODE", code: "CUPOM", scope: "ITEM", targetMenuItemIds: ["m1"] }),
      ],
      couponCode: "CUPOM",
    });
    expect(result.subtotalCents).toBe(0);
    expect(result.applied).toEqual([]);
    expect(reasonFor(result, "d1")).toBe("ZERO_VALUE");
    expectMoneyInvariant(result);
  });

  it("C19: refuses a discount whose only covered line is free", () => {
    const result = evaluateCart({
      lines: [line({ lineId: "l1", menuItemId: "m1", unitPriceCents: 0 })],
      rules: [
        rule({ id: "d1", trigger: "CODE", code: "CUPOM", scope: "ITEM", targetMenuItemIds: ["m1"] }),
      ],
      couponCode: "CUPOM",
    });
    expect(result.applied).toEqual([]);
    expect(reasonFor(result, "d1")).toBe("ZERO_VALUE");
    expectMoneyInvariant(result);
  });

  it("C20: leaves the cart untouched and silent when the tenant has no discounts", () => {
    const result = evaluateCart({ rules: [] });
    expect(result).toMatchObject({
      subtotalCents: 1_000,
      discountTotalCents: 0,
      totalCents: 1_000,
      applied: [],
      rejections: [],
    });
    expectMoneyInvariant(result);
  });

  it("C21: counts a rule repeated in the input exactly once", () => {
    const result = evaluateCart({
      rules: [fixedRule(300, { id: "dup" }), fixedRule(900, { id: "dup" })],
    });
    expect(appliedIds(result)).toEqual(["dup"]);
    expect(result.discountTotalCents).toBe(300);
    expectMoneyInvariant(result);
  });
});

describe("per-line allocation end to end (R7)", () => {
  it("C22: splits an indivisible order-wide percentage across three lines exactly", () => {
    const result = evaluateCart({
      lines: [
        line({ lineId: "l1", unitPriceCents: 333 }),
        line({ lineId: "l2", unitPriceCents: 334 }),
        line({ lineId: "l3", unitPriceCents: 333 }),
      ],
      rules: [rule({ id: "third", percentOffBp: 3_300 })],
    });
    const perLine = result.lines.reduce((sum, entry) => sum + entry.discountCents, 0);
    expect(perLine).toBe(result.discountTotalCents);
    expect(result.lines.map((entry) => entry.lineGrossCents)).toEqual([333, 334, 333]);
    expectMoneyInvariant(result);
  });
});

/** C23 — the invariant, re-asserted over a spread of shapes in one place. */
const INVARIANT_CASES: [string, () => DiscountEvaluation][] = [
  ["an order percentage over uneven lines", () =>
    evaluateCart({
      lines: [
        line({ lineId: "l1", unitPriceCents: 199, quantity: 3 }),
        line({ lineId: "l2", unitPriceCents: 1_050 }),
      ],
      rules: [rule({ id: "d1", percentOffBp: 1_700 })],
    })],
  ["an item discount plus an order discount", () =>
    evaluateCart({
      lines: [ITEM_LINE, line({ lineId: "l2", unitPriceCents: 777 })],
      rules: [
        percentRule(35, { id: "item", scope: "ITEM", targetMenuItemIds: ["m1"] }),
        fixedRule(200, { id: "order" }),
      ],
    })],
  ["a fixed amount larger than the cart", () =>
    evaluateCart({
      lines: [line({ lineId: "l1", unitPriceCents: 90 }), line({ lineId: "l2", unitPriceCents: 11 })],
      rules: [fixedRule(50_000, { id: "d1" })],
    })],
  ["a category discount reaching one of two lines", () =>
    evaluateCart({
      lines: [
        line({ lineId: "l1", categoryPath: ["c-sub", "c-top"], unitPriceCents: 1_999 }),
        line({ lineId: "l2", categoryPath: ["c-other"], unitPriceCents: 500 }),
      ],
      rules: [percentRule(15, { id: "d1", scope: "CATEGORY", targetCategoryIds: ["c-top"] })],
    })],
  ["a cart where every discount is refused", () =>
    evaluateCart({
      lines: [ITEM_LINE],
      rules: [rule({ id: "d1", endsAt: at(-1) }), rule({ id: "d2", active: false })],
    })],
];

describe("the double-entry invariant (C23)", () => {
  it.each(INVARIANT_CASES)("holds for %s", (_label, build) => {
    expectMoneyInvariant(build());
  });
});

describe("determinism (C24)", () => {
  const RULES = [
    percentRule(10, { id: "r-order" }),
    percentRule(20, { id: "r-cat", scope: "CATEGORY", targetCategoryIds: ["c1"] }),
    percentRule(30, { id: "r-item", scope: "ITEM", targetMenuItemIds: ["m1"] }),
    fixedRule(150, { id: "r-exclusive", stackable: false }),
    rule({ id: "r-expired", endsAt: at(-1) }),
    rule({ id: "r-coupon", trigger: "CODE", code: "CUPOM", percentOffBp: 500 }),
  ];

  it("yields identical output for the same input evaluated twice", () => {
    const first = evaluateCart({ lines: [ITEM_LINE], rules: RULES, couponCode: "CUPOM" });
    const second = evaluateCart({ lines: [ITEM_LINE], rules: RULES, couponCode: "CUPOM" });
    expect(second).toEqual(first);
  });

  it("yields identical output when the rules arrive in a different order", () => {
    const shuffled = [RULES[3], RULES[0], RULES[5], RULES[2], RULES[4], RULES[1]].filter(
      (entry): entry is DiscountRule => entry !== undefined,
    );
    const straight = evaluateCart({ lines: [ITEM_LINE], rules: RULES, couponCode: "CUPOM" });
    const reordered = evaluateCart({ lines: [ITEM_LINE], rules: shuffled, couponCode: "CUPOM" });
    expect(reordered).toEqual(straight);
    expectMoneyInvariant(reordered);
  });
});
