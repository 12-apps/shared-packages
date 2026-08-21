import { describe, expect, it } from "vitest";

import { buildLineIndex, coveredLineIds } from "../eligibility";
import type { DiscountRule } from "../types";
import {
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
 * Unit (FUT-245): R2 (the eligibility screen) and R3 (the covered set). Table B
 * of the plan.
 *
 * Everything is driven through `evaluateDiscounts` rather than through
 * `screenRule` alone, because what the ticket actually promises is "this coupon
 * applies / this coupon is refused with THIS reason" — asserting the screen in
 * isolation would let the two drift.
 */

const CATEGORY_LINE = line({
  lineId: "l1",
  menuItemId: "m-base",
  variationMenuItemId: "m-variation",
  categoryPath: ["c-sub", "c-top"],
});

/** A coupon the buyer typed, so the screen's verdict is observable. */
function couponResult(overrides: Partial<DiscountRule>) {
  return evaluateCart({
    lines: [CATEGORY_LINE],
    rules: [rule({ id: "d1", trigger: "CODE", code: "CUPOM", ...overrides })],
    couponCode: "CUPOM",
  });
}

/** The 12 type × scope × trigger combinations that must all simply work. */
const HAPPY_PATHS: [string, Partial<DiscountRule>][] = [
  ["PERCENTAGE/ORDER/AUTOMATIC", { scope: "ORDER" }],
  ["PERCENTAGE/CATEGORY/AUTOMATIC", { scope: "CATEGORY", targetCategoryIds: ["c-top"] }],
  ["PERCENTAGE/ITEM/AUTOMATIC", { scope: "ITEM", targetMenuItemIds: ["m-base"] }],
  ["PERCENTAGE/ORDER/CODE", { scope: "ORDER", trigger: "CODE", code: "CUPOM" }],
  [
    "PERCENTAGE/CATEGORY/CODE",
    { scope: "CATEGORY", targetCategoryIds: ["c-top"], trigger: "CODE", code: "CUPOM" },
  ],
  [
    "PERCENTAGE/ITEM/CODE",
    { scope: "ITEM", targetMenuItemIds: ["m-base"], trigger: "CODE", code: "CUPOM" },
  ],
  ["FIXED_AMOUNT/ORDER/AUTOMATIC", { scope: "ORDER" }],
  ["FIXED_AMOUNT/CATEGORY/AUTOMATIC", { scope: "CATEGORY", targetCategoryIds: ["c-top"] }],
  ["FIXED_AMOUNT/ITEM/AUTOMATIC", { scope: "ITEM", targetMenuItemIds: ["m-base"] }],
  ["FIXED_AMOUNT/ORDER/CODE", { scope: "ORDER", trigger: "CODE", code: "CUPOM" }],
  [
    "FIXED_AMOUNT/CATEGORY/CODE",
    { scope: "CATEGORY", targetCategoryIds: ["c-top"], trigger: "CODE", code: "CUPOM" },
  ],
  [
    "FIXED_AMOUNT/ITEM/CODE",
    { scope: "ITEM", targetMenuItemIds: ["m-base"], trigger: "CODE", code: "CUPOM" },
  ],
];

describe("the type × scope × trigger happy paths", () => {
  it.each(HAPPY_PATHS)("applies a live %s discount", (label, overrides) => {
    const base = label.startsWith("PERCENTAGE")
      ? percentRule(10, { id: "d1", ...overrides })
      : fixedRule(100, { id: "d1", ...overrides });
    const result = evaluateCart({
      lines: [CATEGORY_LINE],
      rules: [base],
      couponCode: label.endsWith("CODE") ? "CUPOM" : null,
    });
    expect(appliedIds(result)).toEqual(["d1"]);
    expect(result.discountTotalCents).toBe(100);
    expectMoneyInvariant(result);
  });
});

describe("the active window (R2)", () => {
  it("B1: refuses a switched-off discount as INACTIVE", () => {
    const result = couponResult({ active: false });
    expect(reasonFor(result, "d1")).toBe("INACTIVE");
    expect(result.applied).toEqual([]);
  });

  it("B2: refuses a discount whose window opens one millisecond from now", () => {
    expect(reasonFor(couponResult({ startsAt: at(1) }), "d1")).toBe("NOT_STARTED");
  });

  it("B3: applies a discount whose window opens exactly now (inclusive bound)", () => {
    expect(appliedIds(couponResult({ startsAt: at(0) }))).toEqual(["d1"]);
  });

  it("B4: refuses a discount whose window closes exactly now (exclusive bound)", () => {
    expect(reasonFor(couponResult({ endsAt: at(0) }), "d1")).toBe("EXPIRED");
  });

  it("B5: applies a discount with one millisecond of window left", () => {
    expect(appliedIds(couponResult({ endsAt: at(1) }))).toEqual(["d1"]);
  });

  it("B6: applies an open-ended discount", () => {
    expect(appliedIds(couponResult({ startsAt: null, endsAt: null }))).toEqual(["d1"]);
  });

  it("B7: refuses an already-closed discount that never had an opening bound", () => {
    expect(reasonFor(couponResult({ startsAt: null, endsAt: at(-1_000) }), "d1")).toBe("EXPIRED");
  });
});

describe("the minimum subtotal (R2)", () => {
  it("B8: applies when the subtotal exactly meets the threshold", () => {
    expect(appliedIds(couponResult({ minSubtotalCents: 1_000 }))).toEqual(["d1"]);
  });

  it("B9: refuses one cent short, and reports the threshold so the UI can name it", () => {
    const result = couponResult({ minSubtotalCents: 1_001 });
    expect(result.rejections).toEqual([
      { discountId: "d1", code: "CUPOM", reason: "MIN_SUBTOTAL_NOT_MET", minSubtotalCents: 1_001 },
    ]);
  });

  it("B10: measures the threshold against the PRE-discount subtotal, not the running total", () => {
    const result = evaluateCart({
      lines: [CATEGORY_LINE],
      rules: [
        percentRule(50, { id: "item-half", scope: "ITEM", targetMenuItemIds: ["m-base"] }),
        percentRule(10, {
          id: "order-tenth",
          trigger: "CODE",
          code: "CUPOM",
          minSubtotalCents: 1_000,
        }),
      ],
      couponCode: "CUPOM",
    });
    expect(appliedIds(result)).toEqual(["item-half", "order-tenth"]);
    expect(result.discountTotalCents).toBe(550);
    expectMoneyInvariant(result);
  });
});

describe("the redemption caps (R2)", () => {
  it("B11: refuses a discount that has reached its global cap", () => {
    const result = couponResult({ usageLimit: 5, usageCount: 5 });
    expect(reasonFor(result, "d1")).toBe("USAGE_LIMIT_REACHED");
  });

  it("B12: applies the last redemption of a capped discount", () => {
    expect(appliedIds(couponResult({ usageLimit: 5, usageCount: 4 }))).toEqual(["d1"]);
  });

  it("B13: ignores the counter entirely when the discount is uncapped", () => {
    expect(appliedIds(couponResult({ usageLimit: null, usageCount: 10_000 }))).toEqual(["d1"]);
  });

  it("B14: refuses a buyer who has already used their per-buyer allowance", () => {
    const result = couponResult({ perBuyerLimit: 2, buyerUsageCount: 2 });
    expect(reasonFor(result, "d1")).toBe("BUYER_LIMIT_REACHED");
  });

  it("B15: applies a once-per-buyer discount to an anonymous cart", () => {
    expect(appliedIds(couponResult({ perBuyerLimit: 1, buyerUsageCount: 0 }))).toEqual(["d1"]);
  });
});

describe("the covered set (R3)", () => {
  it("B16: refuses a category discount that reaches none of the cart's lines", () => {
    const result = couponResult({ scope: "CATEGORY", targetCategoryIds: ["c-other"] });
    expect(reasonFor(result, "d1")).toBe("NO_ELIGIBLE_ITEMS");
  });

  it("B17: covers an item filed on a subcategory from a discount on its parent", () => {
    const index = buildLineIndex([CATEGORY_LINE]);
    const parentRule = rule({ id: "d1", scope: "CATEGORY", targetCategoryIds: ["c-top"] });
    expect([...coveredLineIds(parentRule, [CATEGORY_LINE], index)]).toEqual(["l1"]);
  });

  it("B18: does NOT cover an item filed on the parent from a discount on its subcategory", () => {
    const parentOnly = line({ lineId: "l1", categoryPath: ["c-top"] });
    const index = buildLineIndex([parentOnly]);
    const subRule = rule({ id: "d1", scope: "CATEGORY", targetCategoryIds: ["c-sub"] });
    expect([...coveredLineIds(subRule, [parentOnly], index)]).toEqual([]);
  });

  it("B19: covers a line through the variation the buyer chose", () => {
    const result = couponResult({ scope: "ITEM", targetMenuItemIds: ["m-variation"] });
    expect(appliedIds(result)).toEqual(["d1"]);
  });

  it("B20: refuses an item discount that matches neither the item nor its category", () => {
    const bare = line({ lineId: "l1", menuItemId: "m-other", categoryPath: [] });
    const result = evaluateCart({
      lines: [bare],
      rules: [rule({ id: "d1", trigger: "CODE", code: "CUPOM", scope: "ITEM", targetMenuItemIds: ["m-base"] })],
      couponCode: "CUPOM",
    });
    expect(reasonFor(result, "d1")).toBe("NO_ELIGIBLE_ITEMS");
  });

  it("covers every line of the cart under ORDER scope", () => {
    const lines = [line({ lineId: "l1" }), line({ lineId: "l2" })];
    const index = buildLineIndex(lines);
    expect([...coveredLineIds(rule({ id: "d1" }), lines, index)]).toEqual(["l1", "l2"]);
  });
});

describe("coupon matching (R2)", () => {
  it("B21: leaves an untyped CODE discount out of the evaluation entirely", () => {
    const result = evaluateCart({
      rules: [rule({ id: "d1", trigger: "CODE", code: "CUPOM" })],
      couponCode: null,
    });
    expect(result.applied).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it("B22: matches a coupon case- and whitespace-insensitively", () => {
    const result = evaluateCart({
      rules: [rule({ id: "d1", trigger: "CODE", code: "BEMVINDO10" })],
      couponCode: "  bemvindo10 ",
    });
    expect(appliedIds(result)).toEqual(["d1"]);
  });

  it("B23: reports a code no discount of the tenant carries as UNKNOWN_CODE", () => {
    const result = evaluateCart({
      rules: [rule({ id: "d1", trigger: "CODE", code: "BEMVINDO10" })],
      couponCode: "naoexiste",
    });
    expect(result.rejections).toEqual([
      { discountId: null, code: "NAOEXISTE", reason: "UNKNOWN_CODE" },
    ]);
  });

  it("B24: skips a failing AUTOMATIC discount silently", () => {
    const result = evaluateCart({ rules: [rule({ id: "d1", endsAt: at(-1) })] });
    expect(result.applied).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it("B25: reports a failing CODE discount the buyer actually typed", () => {
    const result = couponResult({ endsAt: at(-1) });
    expect(result.rejections).toEqual([
      { discountId: "d1", code: "CUPOM", reason: "EXPIRED" },
    ]);
  });
});
