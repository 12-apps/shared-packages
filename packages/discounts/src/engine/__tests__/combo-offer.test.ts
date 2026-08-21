import { describe, expect, it } from "vitest";

import { comboOffersForItem, type ComboOffersInput } from "../combo-offer";
import { previewItemDiscount } from "../preview";
import type { DiscountRule } from "../types";
import { NOW, at, bundleRule, comboRule, freeUnitsRule, percentRule, slot } from "./fixtures";

/**
 * Unit (FUT-268): what a menu CARD may say about a combo.
 *
 * Two halves of one decision. A combo has no single-item price, so the badge
 * refuses it (`previewItemDiscount`); what the card can honestly show instead
 * is that the item takes part in one, which is `comboOffersForItem`.
 */

const SNACK_SLOTS = [
  slot({ menuItemIds: ["popcorn-lg"], quantity: 1 }),
  slot({ categoryIds: ["drinks"], quantity: 2 }),
];

function offers(rules: readonly DiscountRule[], overrides: Partial<ComboOffersInput> = {}) {
  return comboOffersForItem({
    menuItemId: "popcorn-lg",
    variationMenuItemId: null,
    categoryPath: ["snacks"],
    rules,
    now: NOW,
    ...overrides,
  });
}

describe("a combo is never badged as a price", () => {
  it("O1: refuses to strike a single item's price through with a combo", () => {
    const badge = previewItemDiscount({
      menuItemId: "popcorn-lg",
      variationMenuItemId: null,
      categoryPath: ["snacks"],
      priceCents: 2_000,
      rules: [bundleRule(2_500, SNACK_SLOTS, { id: "snack" })],
      now: NOW,
    });
    // The R$ 25,00 only exists once the sodas are in the cart; a card quoting
    // it would be promising a price this item alone can never reach.
    expect(badge).toBeNull();
  });

  it("O2: still badges an ordinary item discount on the same item", () => {
    const badge = previewItemDiscount({
      menuItemId: "popcorn-lg",
      variationMenuItemId: null,
      categoryPath: ["snacks"],
      priceCents: 2_000,
      rules: [
        bundleRule(2_500, SNACK_SLOTS, { id: "snack" }),
        percentRule(10, { id: "item-10", scope: "ITEM", targetMenuItemIds: ["popcorn-lg"] }),
      ],
      now: NOW,
    });
    expect(badge?.discountedPriceCents).toBe(1_800);
  });
});

describe("which combos a card may advertise", () => {
  it("O3: reports a combo whose slot names this item", () => {
    const result = offers([bundleRule(2_500, SNACK_SLOTS, { id: "snack", name: "Combo pipoca" })]);
    expect(result).toEqual([
      {
        discountId: "snack",
        name: "Combo pipoca",
        type: "BUNDLE_PRICE",
        bundlePriceCents: 2_500,
        freeUnits: null,
        percentOffBp: null,
        amountOffCents: null,
        requirements: SNACK_SLOTS,
      },
    ]);
  });

  it("O4: reports a combo that reaches this item through its CATEGORY", () => {
    const result = offers(
      [comboRule([slot({ categoryIds: ["snacks"], quantity: 2 })], { id: "two-snacks" })],
      { menuItemId: "chips", categoryPath: ["snacks"] },
    );
    expect(result.map((offer) => offer.discountId)).toEqual(["two-snacks"]);
  });

  it("O5: reports a free-units combo with the count a card needs", () => {
    const result = offers([
      freeUnitsRule(1, [slot({ menuItemIds: ["popcorn-lg"], quantity: 3 })], { id: "3for2" }),
    ]);
    expect(result[0]?.freeUnits).toBe(1);
    expect(result[0]?.type).toBe("FREE_UNITS");
  });

  it("O6: says nothing about an item no slot accepts", () => {
    expect(offers([bundleRule(2_500, SNACK_SLOTS, { id: "snack" })], { menuItemId: "x" })).toEqual(
      [],
    );
  });

  it("O7: ignores discounts that are not combos", () => {
    expect(
      offers([percentRule(10, { id: "item", scope: "ITEM", targetMenuItemIds: ["popcorn-lg"] })]),
    ).toEqual([]);
  });

  it("O8: does not advertise a combo the buyer has to type a coupon for", () => {
    const coupon = bundleRule(2_500, SNACK_SLOTS, {
      id: "snack",
      trigger: "CODE",
      code: "COMBO",
    });
    expect(offers([coupon])).toEqual([]);
  });
});

describe("a combo that is not live is not advertised", () => {
  const UNAVAILABLE: readonly (readonly [string, Partial<DiscountRule>])[] = [
    ["switched off", { active: false }],
    ["not started yet", { startsAt: at(1) }],
    ["already over", { endsAt: at(0) }],
    ["out of global redemptions", { usageLimit: 3, usageCount: 3 }],
  ];

  it.each(UNAVAILABLE)("O9: says nothing about a combo that is %s", (_label, overrides) => {
    expect(offers([bundleRule(2_500, SNACK_SLOTS, { id: "snack", ...overrides })])).toEqual([]);
  });

  it("O10: still advertises a combo carrying a minimum basket, which a card cannot judge", () => {
    const result = offers([
      bundleRule(2_500, SNACK_SLOTS, { id: "snack", minSubtotalCents: 10_000 }),
    ]);
    expect(result.map((offer) => offer.discountId)).toEqual(["snack"]);
  });
});
