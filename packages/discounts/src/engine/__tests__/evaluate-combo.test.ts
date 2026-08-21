import { describe, expect, it } from "vitest";

import {
  appliedIds,
  bundleRule,
  evaluateCart,
  expectMoneyInvariant,
  freeUnitsRule,
  line,
  percentRule,
  reasonFor,
  slot,
} from "./fixtures";

/**
 * Unit (FUT-268): combos inside a real evaluation — the pass order (R6), the
 * shared unit pool and the opacity of what a combo consumed (R10), and how the
 * two interact with the rules that were already here (R4, R8, R9).
 *
 * The matcher's own cases live in ./combo-match.test.ts. What is asserted here
 * is what a BUYER would be charged, so every case states the cart's money.
 */

/** Five burgers on one line, so a combo can take three and leave two. */
const FIVE_BURGERS = line({
  lineId: "l-b",
  menuItemId: "burger",
  categoryPath: ["mains"],
  quantity: 5,
  unitPriceCents: 1_000,
});

const THREE_BURGERS = line({ ...FIVE_BURGERS, quantity: 3 });

const SODA = line({
  lineId: "l-soda",
  menuItemId: "soda",
  categoryPath: ["drinks"],
  quantity: 1,
  unitPriceCents: 500,
});

/** "3 burgers for the price of 2" — one slot of three, one unit free. */
function threeForTwo(id: string, overrides: Record<string, unknown> = {}) {
  return freeUnitsRule(1, [slot({ menuItemIds: ["burger"], quantity: 3 })], { id, ...overrides });
}

describe("pass order and opacity (R6, R10)", () => {
  it("K1: runs the combo pass BEFORE the item pass", () => {
    const result = evaluateCart({
      lines: [FIVE_BURGERS],
      rules: [
        percentRule(10, { id: "item-10", scope: "ITEM", targetMenuItemIds: ["burger"] }),
        threeForTwo("combo"),
      ],
    });
    expect(appliedIds(result)).toEqual(["combo", "item-10"]);
    expectMoneyInvariant(result);
  });

  it("K2: leaves an ITEM discount only the units OUTSIDE the combo, at full price", () => {
    const result = evaluateCart({
      lines: [FIVE_BURGERS],
      rules: [
        percentRule(10, { id: "item-10", scope: "ITEM", targetMenuItemIds: ["burger"] }),
        threeForTwo("combo"),
      ],
    });
    // The combo takes three burgers and gives one away: R$ 10,00. The item
    // promotion then sees the two burgers left, at their full R$ 20,00, and
    // takes R$ 2,00 — not 10% of the whole line, and not 10% of the bundle.
    expect(result.discountTotalCents).toBe(1_000 + 200);
    expect(result.totalCents).toBe(3_800);
    expectMoneyInvariant(result);
  });

  it("K3: hides the combo's units from a CATEGORY discount too", () => {
    const result = evaluateCart({
      lines: [FIVE_BURGERS],
      rules: [
        percentRule(10, { id: "cat-10", scope: "CATEGORY", targetCategoryIds: ["mains"] }),
        threeForTwo("combo"),
      ],
    });
    expect(result.discountTotalCents).toBe(1_000 + 200);
    expectMoneyInvariant(result);
  });

  it("K4: lets an ORDER discount apply to the combo PRICE, because a basket promise covers the basket", () => {
    const result = evaluateCart({
      lines: [FIVE_BURGERS],
      rules: [percentRule(10, { id: "order-10" }), threeForTwo("combo")],
    });
    // R$ 50,00 gross, R$ 10,00 off for the combo, then 10% of the R$ 40,00
    // that is actually left — the combo's own net included.
    expect(result.discountTotalCents).toBe(1_000 + 400);
    expect(result.totalCents).toBe(3_600);
    expectMoneyInvariant(result);
  });

  it("K5: does not touch a line the combo never reached", () => {
    const result = evaluateCart({
      lines: [THREE_BURGERS, SODA],
      rules: [
        percentRule(10, { id: "item-soda", scope: "ITEM", targetMenuItemIds: ["soda"] }),
        threeForTwo("combo"),
      ],
    });
    expect(result.discountTotalCents).toBe(1_000 + 50);
    expectMoneyInvariant(result);
  });
});

describe("the shared unit pool (R10)", () => {
  it("K6: never pays two combos for the same units", () => {
    const result = evaluateCart({
      lines: [THREE_BURGERS, SODA],
      rules: [
        threeForTwo("a-free-burger"),
        bundleRule(
          2_500,
          [
            slot({ menuItemIds: ["burger"], quantity: 3 }),
            slot({ menuItemIds: ["soda"], quantity: 1 }),
          ],
          { id: "b-bundle" },
        ),
      ],
    });
    // Both are worth R$ 10,00 on the pristine cart, so the canonical rule order
    // decides. Whichever wins takes the three burgers, and the loser then finds
    // no burgers left and removes nothing.
    expect(appliedIds(result)).toEqual(["a-free-burger"]);
    expect(result.discountTotalCents).toBe(1_000);
    expectMoneyInvariant(result);
  });

  it("K7: lets the RICHER combo claim the contested units first", () => {
    const result = evaluateCart({
      lines: [THREE_BURGERS, SODA],
      rules: [
        threeForTwo("a-free-burger"),
        bundleRule(
          2_000,
          [
            slot({ menuItemIds: ["burger"], quantity: 3 }),
            slot({ menuItemIds: ["soda"], quantity: 1 }),
          ],
          { id: "b-bundle" },
        ),
      ],
    });
    // The bundle takes R$ 35,00 of goods down to R$ 20,00 — R$ 15,00 off,
    // against the free burger's R$ 10,00 — so it goes first and the free-burger
    // combo is left with nothing to match.
    expect(appliedIds(result)).toEqual(["b-bundle"]);
    expect(result.discountTotalCents).toBe(1_500);
    expectMoneyInvariant(result);
  });

  it("K8: tells a buyer whose combo COUPON lost its units that it took nothing off", () => {
    const result = evaluateCart({
      lines: [THREE_BURGERS],
      rules: [
        threeForTwo("a-automatic"),
        threeForTwo("b-coupon", { trigger: "CODE", code: "COMBO" }),
      ],
      couponCode: "COMBO",
    });
    expect(appliedIds(result)).toEqual(["a-automatic"]);
    expect(reasonFor(result, "b-coupon")).toBe("ZERO_VALUE");
    expectMoneyInvariant(result);
  });
});

describe("a combo that removes nothing consumes nothing", () => {
  it("K9: leaves the whole line to an ITEM discount when the bundle costs more than its parts", () => {
    const result = evaluateCart({
      lines: [THREE_BURGERS],
      rules: [
        bundleRule(5_000, [slot({ menuItemIds: ["burger"], quantity: 3 })], { id: "overpriced" }),
        percentRule(10, { id: "item-10", scope: "ITEM", targetMenuItemIds: ["burger"] }),
      ],
    });
    // The combo is worth nothing, so it must not lock three burgers away from
    // a promotion that would have discounted them.
    expect(appliedIds(result)).toEqual(["item-10"]);
    expect(result.discountTotalCents).toBe(300);
    expectMoneyInvariant(result);
  });
});

describe("the screen (R2, R3)", () => {
  it("K10: reports a combo coupon the cart cannot assemble as COMBO_NOT_MATCHED", () => {
    const result = evaluateCart({
      lines: [SODA],
      rules: [threeForTwo("combo", { trigger: "CODE", code: "LEVE3" })],
      couponCode: "LEVE3",
    });
    expect(reasonFor(result, "combo")).toBe("COMBO_NOT_MATCHED");
    expect(result.discountTotalCents).toBe(0);
  });

  it("K11: keeps NO_ELIGIBLE_ITEMS for the scopes that are not combos", () => {
    const result = evaluateCart({
      lines: [SODA],
      rules: [
        percentRule(10, {
          id: "item",
          scope: "ITEM",
          targetMenuItemIds: ["burger"],
          trigger: "CODE",
          code: "TEN",
        }),
      ],
      couponCode: "TEN",
    });
    expect(reasonFor(result, "item")).toBe("NO_ELIGIBLE_ITEMS");
  });

  it("K12: drops an AUTOMATIC combo the cart cannot assemble in silence", () => {
    const result = evaluateCart({ lines: [SODA], rules: [threeForTwo("combo")] });
    expect(result.rejections).toEqual([]);
    expect(result.discountTotalCents).toBe(0);
  });
});

describe("stacking and the snapshot (R8)", () => {
  it("K13: lets an EXCLUSIVE combo displace the stack when it is worth more", () => {
    const result = evaluateCart({
      lines: [THREE_BURGERS],
      rules: [
        percentRule(10, { id: "order-10" }),
        threeForTwo("combo", { stackable: false }),
      ],
    });
    expect(appliedIds(result)).toEqual(["combo"]);
    expect(result.discountTotalCents).toBe(1_000);
    expect(reasonFor(result, "order-10")).toBe("NOT_STACKABLE");
    expectMoneyInvariant(result);
  });

  it("K14: records how many times the combo applied, for the order snapshot", () => {
    const sixBurgers = line({ ...FIVE_BURGERS, quantity: 6 });
    const result = evaluateCart({ lines: [sixBurgers], rules: [threeForTwo("combo")] });
    expect(result.applied[0]?.comboApplications).toBe(2);
    expect(result.discountTotalCents).toBe(2_000);
    expectMoneyInvariant(result);
  });

  it("K15: carries no application count on a discount that is not a combo", () => {
    const result = evaluateCart({ lines: [THREE_BURGERS], rules: [percentRule(10, { id: "o" })] });
    expect(result.applied[0]).not.toHaveProperty("comboApplications");
  });
});

describe("the two combos a merchant actually asks for", () => {
  it("K16: prices '1 large popcorn + 2 sodas for R$ 25,00'", () => {
    const popcorn = line({ lineId: "l-p", menuItemId: "popcorn-lg", unitPriceCents: 2_000 });
    const sodas = line({
      lineId: "l-s",
      menuItemId: "soda",
      categoryPath: ["drinks"],
      quantity: 2,
      unitPriceCents: 500,
    });
    const result = evaluateCart({
      lines: [popcorn, sodas],
      rules: [
        bundleRule(
          2_500,
          [
            slot({ menuItemIds: ["popcorn-lg"], quantity: 1 }),
            slot({ categoryIds: ["drinks"], quantity: 2 }),
          ],
          { id: "snack-combo", name: "Combo pipoca" },
        ),
      ],
    });
    expect(result.subtotalCents).toBe(3_000);
    expect(result.discountTotalCents).toBe(500);
    expect(result.totalCents).toBe(2_500);
    expectMoneyInvariant(result);
  });

  it("K17: prices '3 burgers for the price of 2', twice over, on a cart of seven", () => {
    const sevenBurgers = line({ ...FIVE_BURGERS, quantity: 7 });
    const result = evaluateCart({ lines: [sevenBurgers], rules: [threeForTwo("combo")] });
    // Seven burgers: two combos of three (two free) and one at full price.
    expect(result.subtotalCents).toBe(7_000);
    expect(result.discountTotalCents).toBe(2_000);
    expect(result.totalCents).toBe(5_000);
    expect(result.applied[0]?.comboApplications).toBe(2);
    expectMoneyInvariant(result);
  });
});
