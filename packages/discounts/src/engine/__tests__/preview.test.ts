import { describe, expect, it } from "vitest";

import { MIN_PAYABLE_TOTAL_CENTS } from "../kinds";
import { previewItemDiscount, type ItemDiscountPreviewInput } from "../preview";
import type { DiscountRule } from "../types";
import { NOW, at, percentRule, rule } from "./fixtures";

/**
 * Unit (FUT-246 / FUT-245): the menu badge preview. Table D of the plan.
 *
 * The badge is a promise made on a catalog card, before there is a cart, so the
 * interesting assertions here are mostly about what it REFUSES to promise.
 */

function preview(rules: readonly DiscountRule[], overrides: Partial<ItemDiscountPreviewInput> = {}) {
  return previewItemDiscount({
    menuItemId: "m-base",
    variationMenuItemId: null,
    categoryPath: ["c-sub", "c-top"],
    priceCents: 1_000,
    rules,
    now: NOW,
    ...overrides,
  });
}

const ITEM_20 = percentRule(20, {
  id: "item-20",
  name: "Terça em dobro",
  scope: "ITEM",
  targetMenuItemIds: ["m-base"],
});

describe("previewItemDiscount", () => {
  it("D1: badges an automatic item discount that is in its window", () => {
    expect(preview([ITEM_20])).toEqual({
      discountedPriceCents: 800,
      promoLabel: "Terça em dobro",
    });
  });

  it("D2: badges an item reached through its parent category", () => {
    const parentPromo = percentRule(10, {
      id: "cat-10",
      scope: "CATEGORY",
      targetCategoryIds: ["c-top"],
    });
    expect(preview([parentPromo])?.discountedPriceCents).toBe(900);
  });

  it("D3: never badges an order-wide discount — it is not an item price", () => {
    expect(preview([percentRule(20, { id: "order-20" })])).toBeNull();
  });

  it("D4: never badges a coupon the buyer has not typed", () => {
    const coupon = percentRule(20, {
      id: "coupon",
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
      trigger: "CODE",
      code: "CUPOM",
    });
    expect(preview([coupon])).toBeNull();
  });

  it("D5: never badges a price that only exists above a minimum subtotal", () => {
    const conditional = percentRule(20, {
      id: "conditional",
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
      minSubtotalCents: 5_000,
    });
    expect(preview([conditional])).toBeNull();
  });

  it("D8: never badges a discount too small to remove a whole cent", () => {
    const crumb = rule({
      id: "crumb",
      percentOffBp: 100,
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
    });
    expect(preview([crumb], { priceCents: 50 })).toBeNull();
  });

  it("badges R$ 0,01 at 100% off, never R$ 0,00", () => {
    // The card may not advertise a price the checkout cannot charge: the
    // provider rejects a zero-amount charge, so the badge stops at the same
    // payable floor the cart stops at (R9).
    const freebie = percentRule(100, {
      id: "freebie",
      name: "Brinde",
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
    });
    expect(preview([freebie])).toEqual({
      discountedPriceCents: MIN_PAYABLE_TOTAL_CENTS,
      promoLabel: "Brinde",
    });
  });

  it("does not badge an item already priced at the payable floor", () => {
    // Nothing can come off a one-cent item and still leave a chargeable price,
    // so there is no promise to put on the card at all.
    const freebie = percentRule(100, {
      id: "freebie",
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
    });
    expect(preview([freebie], { priceCents: MIN_PAYABLE_TOTAL_CENTS })).toBeNull();
  });

  it("ranks competing badges by what they may actually take off, not by what they ask", () => {
    // On a 100-cent item, 99% and 100% both come to 99 once the floor is
    // applied. That is a genuine tie, so the canonical rule order decides and the
    // lower id is named — ranking on the pre-floor 100 would have picked the
    // other one while showing the very same price.
    const most = percentRule(99, {
      id: "a-most",
      name: "Quase tudo",
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
    });
    const all = percentRule(100, {
      id: "z-all",
      name: "Tudo",
      scope: "ITEM",
      targetMenuItemIds: ["m-base"],
    });
    expect(preview([most, all], { priceCents: 100 })).toEqual({
      discountedPriceCents: 1,
      promoLabel: "Quase tudo",
    });
  });

  it("badges a variation the card prices, not only the grouping item", () => {
    const variationPromo = percentRule(50, {
      id: "variation-50",
      scope: "ITEM",
      targetMenuItemIds: ["m-variation"],
    });
    const result = preview([variationPromo], { variationMenuItemId: "m-variation" });
    expect(result?.discountedPriceCents).toBe(500);
  });
});

/** D6 — every way a live-looking rule can fail the screen still means "no badge". */
const UNAVAILABLE: [string, Partial<DiscountRule>][] = [
  ["switched off", { active: false }],
  ["not started yet", { startsAt: at(1) }],
  ["already over", { endsAt: at(0) }],
  ["out of global redemptions", { usageLimit: 3, usageCount: 3 }],
  ["out of per-buyer redemptions", { perBuyerLimit: 1, buyerUsageCount: 1 }],
];

describe("D6: an unavailable discount is not badged", () => {
  it.each(UNAVAILABLE)("does not badge a discount that is %s", (_label, overrides) => {
    expect(preview([percentRule(20, { ...ITEM_20, ...overrides })])).toBeNull();
  });
});

describe("D7: competing item discounts", () => {
  const SMALL = percentRule(10, {
    id: "a-small",
    scope: "ITEM",
    targetMenuItemIds: ["m-base"],
    name: "Menor",
  });
  const BIG = percentRule(30, {
    id: "z-big",
    scope: "ITEM",
    targetMenuItemIds: ["m-base"],
    name: "Maior",
  });

  it("badges the larger saving", () => {
    expect(preview([SMALL, BIG])).toEqual({ discountedPriceCents: 700, promoLabel: "Maior" });
  });

  it("badges the same one regardless of the order the rules arrive in", () => {
    expect(preview([BIG, SMALL])).toEqual(preview([SMALL, BIG]));
  });
});
