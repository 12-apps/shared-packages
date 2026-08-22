import { describe, expect, it } from "vitest";

import {
  comboCoveredLineIds,
  comboSlotAcceptsLine,
  freshComboPool,
  matchCombo,
} from "../combo-match";
import type { ComboMatch } from "../combo-match";
import type { DiscountCartLine } from "../types";
import { bundleRule, comboRule, freeUnitsRule, line, slot } from "./fixtures";

/**
 * Unit (FUT-268): the combo MATCHER on its own, with no cart evaluation around
 * it — which units a combo takes, how many times it takes them, and what that
 * is worth. The cart-level consequences (pass order, opacity, the shared pool,
 * stacking) are in ./evaluate-combo.test.ts.
 *
 * Every price here is a round number of cents chosen so an expectation reads as
 * arithmetic a reviewer can do in their head.
 */

const POPCORN = line({ lineId: "l-popcorn", menuItemId: "popcorn-lg", unitPriceCents: 2_000 });
const SODAS = line({
  lineId: "l-soda",
  menuItemId: "soda",
  categoryPath: ["drinks"],
  quantity: 2,
  unitPriceCents: 500,
});

/** The combo of the epic's own example: 1 large popcorn + 2 sodas. */
const SNACK_SLOTS = [
  slot({ menuItemIds: ["popcorn-lg"], quantity: 1 }),
  slot({ categoryIds: ["drinks"], quantity: 2 }),
];

function match(rule: Parameters<typeof matchCombo>[0], lines: readonly DiscountCartLine[]) {
  return matchCombo(rule, freshComboPool(lines));
}

/** The consumed-unit map as a plain object, so a case can state it whole. */
function units(result: ComboMatch | null): Record<string, number> {
  return Object.fromEntries(result?.consumedUnitsByLine ?? new Map());
}

describe("filling the slots", () => {
  it("M1: fills every slot once from a cart holding exactly the components", () => {
    const result = match(comboRule(SNACK_SLOTS, { id: "snack" }), [POPCORN, SODAS]);
    expect(result?.applications).toBe(1);
    expect(units(result)).toEqual({ "l-popcorn": 1, "l-soda": 2 });
    expect(result?.groupCents).toBe(2_000 + 1_000);
  });

  it("M2: does not match at all when one slot is short", () => {
    const oneSoda = line({ ...SODAS, quantity: 1 });
    expect(match(comboRule(SNACK_SLOTS, { id: "snack" }), [POPCORN, oneSoda])).toBeNull();
  });

  it("M3: is ALL-OR-NOTHING — a half-filled application consumes nothing", () => {
    // The popcorn slot fills and the drinks slot cannot, so the popcorn must
    // stay outside the combo rather than being charged for a bundle the buyer
    // was never given.
    const result = match(comboRule(SNACK_SLOTS, { id: "snack" }), [POPCORN]);
    expect(result).toBeNull();
  });

  it("M4: repeats while the cart can still fill every slot", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 7, unitPriceCents: 900 });
    const result = match(
      freeUnitsRule(1, [slot({ menuItemIds: ["burger"], quantity: 3 })], { id: "3for2" }),
      [burgers],
    );
    expect(result?.applications).toBe(2);
    expect(units(result)).toEqual({ "l-b": 6 });
  });

  it("M5: stops at maxComboApplications", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 9, unitPriceCents: 900 });
    const result = match(
      freeUnitsRule(1, [slot({ menuItemIds: ["burger"], quantity: 3 })], {
        id: "3for2",
        maxComboApplications: 2,
      }),
      [burgers],
    );
    expect(result?.applications).toBe(2);
    expect(units(result)).toEqual({ "l-b": 6 });
  });

  it("M5b: treats a stored cap of ZERO as 'never', not as 'uncapped'", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 9, unitPriceCents: 900 });
    const result = match(
      freeUnitsRule(1, [slot({ menuItemIds: ["burger"], quantity: 3 })], {
        id: "3for2",
        maxComboApplications: 0,
      }),
      [burgers],
    );
    expect(result).toBeNull();
  });

  it("M6: refuses a zero-quantity slot instead of looping on it", () => {
    const result = match(comboRule([slot({ menuItemIds: ["burger"], quantity: 0 })], { id: "z" }), [
      line({ lineId: "l-b", menuItemId: "burger", quantity: 3 }),
    ]);
    expect(result).toBeNull();
  });

  it("M7: refuses a combo with no slots at all", () => {
    expect(match(comboRule([], { id: "empty" }), [POPCORN, SODAS])).toBeNull();
  });
});

describe("which units a slot takes", () => {
  it("M8: takes the DEAREST eligible units first", () => {
    const cheap = line({ lineId: "l-cheap", menuItemId: "burger", quantity: 2, unitPriceCents: 700 });
    const dear = line({ lineId: "l-dear", menuItemId: "burger", quantity: 2, unitPriceCents: 1_200 });
    const result = match(
      comboRule([slot({ menuItemIds: ["burger"], quantity: 3 })], { id: "any3" }),
      [cheap, dear],
    );
    // Both dear units, then one cheap one to make up the three.
    expect(units(result)).toEqual({ "l-dear": 2, "l-cheap": 1 });
    expect(result?.groupCents).toBe(1_200 * 2 + 700);
  });

  it("M9: reaches a line through its chosen VARIATION, not only its base item", () => {
    const zeroCan = line({
      lineId: "l-zero",
      menuItemId: "soda",
      variationMenuItemId: "soda-zero-can",
      quantity: 2,
      unitPriceCents: 500,
    });
    const result = match(
      comboRule(
        [
          slot({ menuItemIds: ["popcorn-lg"], quantity: 1 }),
          slot({ menuItemIds: ["soda-zero-can"], quantity: 2 }),
        ],
        { id: "snack" },
      ),
      [POPCORN, zeroCan],
    );
    expect(units(result)).toEqual({ "l-popcorn": 1, "l-zero": 2 });
  });

  it("M10: reaches a line through a category ANCESTOR on its path", () => {
    const water = line({
      lineId: "l-water",
      menuItemId: "water",
      categoryPath: ["still-drinks", "drinks"],
      quantity: 2,
      unitPriceCents: 400,
    });
    const result = match(comboRule(SNACK_SLOTS, { id: "snack" }), [POPCORN, water]);
    expect(units(result)).toEqual({ "l-popcorn": 1, "l-water": 2 });
  });

  it("M11: fills the MOST CONSTRAINED slot first, so a broad slot cannot eat a narrow one's only candidate", () => {
    // The popcorn is itself filed under `snacks`, and the second slot accepts
    // anything in `snacks`. Filling the broad slot first would spend the only
    // popcorn on it and leave the specific slot unfillable.
    const popcorn = line({
      lineId: "l-popcorn",
      menuItemId: "popcorn-lg",
      categoryPath: ["snacks"],
      unitPriceCents: 2_000,
    });
    const chips = line({
      lineId: "l-chips",
      menuItemId: "chips",
      categoryPath: ["snacks"],
      unitPriceCents: 800,
    });
    const result = match(
      comboRule(
        [
          slot({ categoryIds: ["snacks"], quantity: 1 }),
          slot({ menuItemIds: ["popcorn-lg"], quantity: 1 }),
        ],
        { id: "two-snacks" },
      ),
      [popcorn, chips],
    );
    expect(result?.applications).toBe(1);
    expect(units(result)).toEqual({ "l-popcorn": 1, "l-chips": 1 });
  });

  it("M12: matches against a POOL that a previous combo already drew down", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 6, unitPriceCents: 900 });
    const rule = freeUnitsRule(1, [slot({ menuItemIds: ["burger"], quantity: 3 })], { id: "3for2" });
    const drawn = { unitsByLine: new Map([["l-b", 3]]), linesById: new Map([["l-b", burgers]]) };
    const result = matchCombo(rule, drawn);
    expect(result?.applications).toBe(1);
    expect(units(result)).toEqual({ "l-b": 3 });
  });
});

describe("what one application is worth", () => {
  it("M13: BUNDLE_PRICE removes the group's value above the bundle price", () => {
    const result = match(bundleRule(2_500, SNACK_SLOTS, { id: "snack" }), [POPCORN, SODAS]);
    expect(result?.groupCents).toBe(3_000);
    expect(result?.rewardCents).toBe(500);
  });

  it("M14: BUNDLE_PRICE removes nothing when the bundle costs more than its parts", () => {
    const result = match(bundleRule(4_000, SNACK_SLOTS, { id: "snack" }), [POPCORN, SODAS]);
    expect(result?.rewardCents).toBe(0);
  });

  it("M15: FREE_UNITS gives away the CHEAPEST units of each application", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 2, unitPriceCents: 1_200 });
    const wrap = line({ lineId: "l-w", menuItemId: "wrap", quantity: 1, unitPriceCents: 700 });
    const result = match(
      freeUnitsRule(1, [slot({ menuItemIds: ["burger", "wrap"], quantity: 3 })], { id: "3for2" }),
      [burgers, wrap],
    );
    expect(result?.rewardCents).toBe(700);
  });

  it("M16: prices EVERY application, not just the first", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 6, unitPriceCents: 900 });
    const result = match(
      freeUnitsRule(1, [slot({ menuItemIds: ["burger"], quantity: 3 })], { id: "3for2" }),
      [burgers],
    );
    expect(result?.applications).toBe(2);
    expect(result?.rewardCents).toBe(1_800);
  });

  it("M17: a FIXED_AMOUNT combo removes its amount PER application", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 4, unitPriceCents: 900 });
    const result = match(
      comboRule([slot({ menuItemIds: ["burger"], quantity: 2 })], {
        id: "two-off",
        type: "FIXED_AMOUNT",
        percentOffBp: null,
        amountOffCents: 300,
      }),
      [burgers],
    );
    expect(result?.applications).toBe(2);
    expect(result?.rewardCents).toBe(600);
  });

  it("M18: a PERCENTAGE combo takes its rate off the matched group", () => {
    const result = match(comboRule(SNACK_SLOTS, { id: "snack", percentOffBp: 1_000 }), [
      POPCORN,
      SODAS,
    ]);
    expect(result?.rewardCents).toBe(300);
  });

  it("M19: never rewards more than the group is worth", () => {
    const burgers = line({ lineId: "l-b", menuItemId: "burger", quantity: 2, unitPriceCents: 100 });
    const result = match(
      comboRule([slot({ menuItemIds: ["burger"], quantity: 2 })], {
        id: "huge",
        type: "FIXED_AMOUNT",
        percentOffBp: null,
        amountOffCents: 999_999,
      }),
      [burgers],
    );
    expect(result?.rewardCents).toBe(200);
    expect(result?.rewardCents).toBeLessThanOrEqual(result?.groupCents ?? 0);
  });
});

describe("the covered set the screen reads (R3)", () => {
  it("M20: covers the lines a pristine cart lets the combo take", () => {
    const covered = comboCoveredLineIds(comboRule(SNACK_SLOTS, { id: "snack" }), [POPCORN, SODAS]);
    expect([...covered].sort()).toEqual(["l-popcorn", "l-soda"]);
  });

  it("M21: covers NOTHING when the cart cannot assemble the combo", () => {
    expect(comboCoveredLineIds(comboRule(SNACK_SLOTS, { id: "snack" }), [POPCORN]).size).toBe(0);
  });
});

describe("which GROUP a product fills", () => {
  /*
   * The question a storefront asks and the cart never does. "Escolha 2
   * refrigerantes" has to offer sodas and not popcorn, and the ONLY safe answer
   * is the matcher's own predicate — a host deriving it would eventually offer
   * a product the matcher refuses, i.e. a combo the buyer assembles on screen
   * and never earns.
   */

  it("M23: a slot naming a category accepts anything on that path, and nothing else", () => {
    const drinks = slot({ categoryIds: ["drinks"], quantity: 2 });
    expect(comboSlotAcceptsLine(drinks, SODAS)).toBe(true);
    expect(comboSlotAcceptsLine(drinks, POPCORN)).toBe(false);
  });

  it("M24: a slot naming an item accepts that item, and not its category siblings", () => {
    const popcorn = slot({ menuItemIds: ["popcorn-lg"], quantity: 1 });
    expect(comboSlotAcceptsLine(popcorn, POPCORN)).toBe(true);
    expect(comboSlotAcceptsLine(popcorn, SODAS)).toBe(false);
  });

  it("M25: it reaches a chosen VARIATION, the same way an ITEM-scoped rule does", () => {
    const zero = line({
      lineId: "l-zero",
      menuItemId: "soda",
      variationMenuItemId: "soda-zero",
      categoryPath: [],
    });
    expect(comboSlotAcceptsLine(slot({ menuItemIds: ["soda-zero"] }), zero)).toBe(true);
  });

  it("M26: a slot naming both accepts either — the two lists are a union", () => {
    const either = slot({ menuItemIds: ["popcorn-lg"], categoryIds: ["drinks"], quantity: 1 });
    expect(comboSlotAcceptsLine(either, POPCORN)).toBe(true);
    expect(comboSlotAcceptsLine(either, SODAS)).toBe(true);
  });

  it("M27: a slot naming nothing accepts nothing, rather than everything", () => {
    // The empty-target group the admin form refuses. If it ever reaches the
    // storefront it must offer an empty picker, not the whole menu.
    expect(comboSlotAcceptsLine(slot({ quantity: 1 }), SODAS)).toBe(false);
  });
});
