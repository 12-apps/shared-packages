import { describe, expect, it } from "vitest";

import { previewItemDiscount } from "../preview";
import type { DiscountCartLine, DiscountRule } from "../types";
import {
  NOW,
  bundleRule,
  evaluateCart,
  expectMoneyInvariant,
  fixedRule,
  line,
  slot,
} from "./fixtures";

/**
 * Unit: a FIXED_AMOUNT aimed at products or categories comes off EACH covered
 * unit (R5 per unit). Before, it came off once across the covered lines, so the
 * cart disagreed with the menu badge as soon as a second highlighted unit was in
 * it: "R$ 10 off nos destaques" badged R$ 49 → R$ 39 and R$ 45 → R$ 35, and the
 * cart charged R$ 43,79 and R$ 40,21.
 */

const BOLINHO = line({
  lineId: "l-bolinho",
  menuItemId: "bolinho",
  categoryPath: ["porcoes", "entradas"],
  unitPriceCents: 4_900,
});

const BURGER = line({
  lineId: "l-burger",
  menuItemId: "burger",
  categoryPath: ["com-bacon", "burgers"],
  unitPriceCents: 4_500,
});

const SODA = line({
  lineId: "l-soda",
  menuItemId: "soda",
  categoryPath: ["drinks"],
  unitPriceCents: 600,
});

const DESTAQUES = fixedRule(1_000, {
  id: "destaques",
  name: "R$ 10 off nos destaques",
  scope: "ITEM",
  targetMenuItemIds: ["bolinho", "burger"],
});

function netByLine(lines: readonly DiscountCartLine[], rules: readonly DiscountRule[]) {
  const result = evaluateCart({ lines, rules });
  expectMoneyInvariant(result);
  return Object.fromEntries(result.lines.map((entry) => [entry.lineId, entry.lineNetCents]));
}

function badgedPrice(item: DiscountCartLine, rules: readonly DiscountRule[]): number | undefined {
  return previewItemDiscount({
    menuItemId: item.menuItemId,
    categoryPath: item.categoryPath,
    priceCents: item.unitPriceCents,
    rules,
    now: NOW,
  })?.discountedPriceCents;
}

describe("a fixed amount on products or categories comes off each unit", () => {
  it("U1: charges each line the price its menu badge showed", () => {
    expect(netByLine([BOLINHO, BURGER], [DESTAQUES])).toEqual({
      "l-bolinho": badgedPrice(BOLINHO, [DESTAQUES]),
      "l-burger": badgedPrice(BURGER, [DESTAQUES]),
    });
    expect(netByLine([BOLINHO, BURGER], [DESTAQUES])).toEqual({
      "l-bolinho": 3_900,
      "l-burger": 3_500,
    });
  });

  it("U2: takes the amount off every unit of a line with quantity", () => {
    expect(netByLine([{ ...BOLINHO, quantity: 2 }], [DESTAQUES])).toEqual({
      "l-bolinho": 7_800,
    });
  });

  it("U3: clamps the amount to each unit's own price", () => {
    const rule = fixedRule(1_000, { id: "drinks", scope: "ITEM", targetMenuItemIds: ["soda"] });
    expect(netByLine([{ ...SODA, quantity: 3 }, BURGER], [rule])).toEqual({
      "l-soda": 0,
      "l-burger": 4_500,
    });
  });

  it("U4: applies per unit at CATEGORY scope too", () => {
    const rule = fixedRule(700, { id: "burgers", scope: "CATEGORY", targetCategoryIds: ["burgers"] });
    expect(netByLine([{ ...BURGER, quantity: 2 }, BOLINHO], [rule])).toEqual({
      "l-burger": 7_600,
      "l-bolinho": 4_900,
    });
  });

  it("U5: keeps an ORDER-scoped fixed amount once per order", () => {
    const result = evaluateCart({
      lines: [BOLINHO, { ...BURGER, quantity: 2 }],
      rules: [fixedRule(1_000, { id: "order" })],
    });
    expect(result.discountTotalCents).toBe(1_000);
    expectMoneyInvariant(result);
  });

  it("U6: gives no part of the amount to units a combo consumed (R10)", () => {
    const combo = bundleRule(8_000, [slot({ menuItemIds: ["burger"], quantity: 2 })], {
      id: "combo",
    });
    const result = evaluateCart({ lines: [{ ...BURGER, quantity: 3 }], rules: [combo, DESTAQUES] });
    expect(result.applied.map((entry) => [entry.discountId, entry.amountCents])).toEqual([
      ["combo", 1_000],
      ["destaques", 1_000],
    ]);
    expectMoneyInvariant(result);
  });

  it("U7: never takes more than an earlier pass left on the line (R4)", () => {
    const category = fixedRule(4_000, {
      id: "category",
      scope: "CATEGORY",
      targetCategoryIds: ["burgers"],
    });
    const result = evaluateCart({ lines: [BURGER, SODA], rules: [DESTAQUES, category] });
    expect(result.applied.map((entry) => [entry.discountId, entry.amountCents])).toEqual([
      ["destaques", 1_000],
      ["category", 3_500],
    ]);
    expectMoneyInvariant(result);
  });

  it("U8: still leaves the order its payable cent (R9)", () => {
    const result = evaluateCart({ lines: [{ ...SODA, quantity: 2 }], rules: [
      fixedRule(1_000, { id: "drinks", scope: "ITEM", targetMenuItemIds: ["soda"] }),
    ] });
    expect(result.totalCents).toBe(1);
    expectMoneyInvariant(result);
  });
});
