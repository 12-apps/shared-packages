import { describe, expect, it } from "vitest";

import {
  appliedIds,
  at,
  evaluateCart,
  expectMoneyInvariant,
  fixedRule,
  line,
  reasonFor,
  rule,
} from "./fixtures";

/**
 * Unit (FUT-245): R8, the stacking decision. Cases C8–C14 of the plan, split
 * out of ./evaluate.test.ts so neither suite runs at the size gate.
 *
 * The shape of R8 is "the stack (every stackable discount together) versus the
 * best single exclusive one, more cents off wins" — with one absolute
 * exception: a coupon the buyer actually typed is never silently discarded.
 */

const CART = [line({ lineId: "l1", unitPriceCents: 2_000 })];

function stackCase(args: {
  exclusives: readonly number[];
  stackables: readonly number[];
  couponCents?: number;
  couponStackable?: boolean;
}) {
  const exclusives = args.exclusives.map((cents, index) =>
    fixedRule(cents, { id: `x${index}`, stackable: false }),
  );
  const stackables = args.stackables.map((cents, index) =>
    fixedRule(cents, { id: `s${index}` }),
  );
  const coupon =
    args.couponCents === undefined
      ? []
      : [
          fixedRule(args.couponCents, {
            id: "coupon",
            trigger: "CODE",
            code: "CUPOM",
            stackable: args.couponStackable ?? false,
          }),
        ];
  return evaluateCart({
    lines: CART,
    rules: [...exclusives, ...stackables, ...coupon],
    couponCode: args.couponCents === undefined ? null : "CUPOM",
  });
}

describe("stack versus best single (R8)", () => {
  it("C8: lets the bigger exclusive discount win, and says what it displaced", () => {
    const result = stackCase({ exclusives: [600], stackables: [300, 100] });
    expect(appliedIds(result)).toEqual(["x0"]);
    expect(result.discountTotalCents).toBe(600);
    expect(result.rejections).toEqual([
      { discountId: "s0", code: null, reason: "NOT_STACKABLE", supersededByDiscountId: "x0" },
      { discountId: "s1", code: null, reason: "NOT_STACKABLE", supersededByDiscountId: "x0" },
    ]);
    expectMoneyInvariant(result);
  });

  it("C9: lets the stack win, and keeps the losing automatic promo out of sight", () => {
    const result = stackCase({ exclusives: [300], stackables: [300, 100] });
    expect(appliedIds(result)).toEqual(["s0", "s1"]);
    expect(result.discountTotalCents).toBe(400);
    expect(result.rejections).toEqual([]);
    expectMoneyInvariant(result);
  });

  it("C10: breaks a dead heat in favour of the stack", () => {
    const result = stackCase({ exclusives: [400], stackables: [300, 100] });
    expect(appliedIds(result)).toEqual(["s0", "s1"]);
    expect(result.discountTotalCents).toBe(400);
    expectMoneyInvariant(result);
  });

  it("C11: applies only the best of two exclusive discounts", () => {
    const result = stackCase({ exclusives: [500, 700], stackables: [] });
    expect(appliedIds(result)).toEqual(["x1"]);
    expect(result.discountTotalCents).toBe(700);
    expectMoneyInvariant(result);
  });

  it("settles two equally good exclusives on the canonical rule order, not on luck", () => {
    // Outcome B's own tie-break: same saving and same age, so the lower id wins
    // — the merchant sees the same promo named every time the cart is repriced.
    const result = stackCase({ exclusives: [400, 400], stackables: [] });
    expect(appliedIds(result)).toEqual(["x0"]);
    expect(result.discountTotalCents).toBe(400);
    expectMoneyInvariant(result);
  });
});

/**
 * R8 × R9. Both outcomes are built with the payable floor already imposed, so
 * the comparison is between what each would REALLY remove. Comparing the
 * pre-clamp figures would let an outcome win on a cent it is not allowed to take.
 */
describe("the payable floor inside the stacking decision (R8/R9)", () => {
  it("floors outcome B, the single exclusive discount, like any other outcome", () => {
    const result = stackCase({ exclusives: [50_000], stackables: [] });
    expect(appliedIds(result)).toEqual(["x0"]);
    expect(result.discountTotalCents).toBe(1_999);
    expect(result.totalCents).toBe(1);
    expectMoneyInvariant(result);
  });

  it("floors outcome A, the stack, and keeps its parts adding up", () => {
    const result = stackCase({ exclusives: [], stackables: [1_500, 1_500] });
    expect(appliedIds(result)).toEqual(["s0", "s1"]);
    expect(result.applied.map((entry) => entry.amountCents)).toEqual([1_500, 499]);
    expect(result.discountTotalCents).toBe(1_999);
    expect(result.totalCents).toBe(1);
    expectMoneyInvariant(result);
  });

  it("compares the two outcomes AFTER the floor, not before it", () => {
    // Pre-clamp the exclusive asks for the whole 2_000 and the stack for 1_999,
    // so a comparison of raw figures would crown the exclusive and displace the
    // stack. Both are in fact capped to 1_999, which is a tie — and a tie goes to
    // the stack, so the buyer keeps the promotion they were shown and nothing is
    // reported as superseded. Same money either way; only the honest comparison
    // gets the applied set right.
    const result = stackCase({ exclusives: [2_000], stackables: [1_999] });
    expect(appliedIds(result)).toEqual(["s0"]);
    expect(result.discountTotalCents).toBe(1_999);
    expect(result.totalCents).toBe(1);
    expect(result.rejections).toEqual([]);
    expectMoneyInvariant(result);
  });
});

describe("the coupon override (R8)", () => {
  it("C12: applies an exclusive coupon the buyer typed even when it saves less", () => {
    const result = stackCase({ exclusives: [], stackables: [500, 400], couponCents: 200 });
    expect(appliedIds(result)).toEqual(["coupon"]);
    expect(result.discountTotalCents).toBe(200);
    expect(result.rejections.map((rejection) => rejection.reason)).toEqual([
      "NOT_STACKABLE",
      "NOT_STACKABLE",
    ]);
    expect(result.rejections.every((r) => r.supersededByDiscountId === "coupon")).toBe(true);
    expectMoneyInvariant(result);
  });

  it("prefers the coupon the buyer typed over a richer exclusive promo they did not", () => {
    // The override is absolute, not "best of the exclusives": someone who typed
    // a code must never be told, silently, that the store knew better.
    const result = stackCase({ exclusives: [900], stackables: [], couponCents: 200 });
    expect(appliedIds(result)).toEqual(["coupon"]);
    expect(result.discountTotalCents).toBe(200);
    expectMoneyInvariant(result);
  });

  it("C13: adds a stackable coupon to the automatic promotions instead of replacing them", () => {
    const result = stackCase({
      exclusives: [],
      stackables: [500, 400],
      couponCents: 200,
      couponStackable: true,
    });
    expect(appliedIds(result)).toEqual(["s0", "s1", "coupon"]);
    expect(result.discountTotalCents).toBe(1_100);
    expect(result.rejections).toEqual([]);
    expectMoneyInvariant(result);
  });

  it("keeps the stack when an exclusive coupon turns out to be worth nothing", () => {
    const result = evaluateCart({
      lines: CART,
      rules: [
        fixedRule(500, { id: "s0" }),
        fixedRule(400, { id: "s1" }),
        rule({
          id: "coupon",
          trigger: "CODE",
          code: "CUPOM",
          stackable: false,
          percentOffBp: 1,
        }),
      ],
      couponCode: "CUPOM",
    });
    expect(appliedIds(result)).toEqual(["s0", "s1"]);
    expect(result.discountTotalCents).toBe(900);
    expect(reasonFor(result, "coupon")).toBe("ZERO_VALUE");
    expectMoneyInvariant(result);
  });

  it("C14: refuses an ineligible coupon on its own merits and keeps the stack running", () => {
    const result = evaluateCart({
      lines: CART,
      rules: [
        fixedRule(500, { id: "s0" }),
        fixedRule(400, { id: "s1" }),
        fixedRule(900, {
          id: "coupon",
          trigger: "CODE",
          code: "CUPOM",
          stackable: false,
          endsAt: at(-1),
        }),
      ],
      couponCode: "CUPOM",
    });
    expect(appliedIds(result)).toEqual(["s0", "s1"]);
    expect(reasonFor(result, "coupon")).toBe("EXPIRED");
    expect(result.discountTotalCents).toBe(900);
    expectMoneyInvariant(result);
  });
});
