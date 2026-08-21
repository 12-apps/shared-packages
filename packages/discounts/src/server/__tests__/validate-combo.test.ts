import { describe, expect, it } from "vitest";

import { MAX_COMBO_SLOTS, MAX_COMBO_SLOT_QUANTITY } from "../../engine/kinds";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import {
  DiscountValidationError,
  targetsForScope,
  toDiscountScalars,
  toDiscountWriteInput,
  type DiscountWriteBody,
} from "../validate";

/**
 * Unit (FUT-268): the write-time rules for a combo.
 *
 * Driven through `toDiscountWriteInput` rather than by hand-building a
 * `DiscountWriteInput`, so each case also exercises the wire folding an MCP
 * call or a REST client actually goes through — "omitted" and "explicitly
 * null" have to collapse the same way for the new fields as for the old ones.
 *
 * What is asserted on a failure is the FIELD, never the sentence: the sentence
 * is host config and a case pinning it would be pinning the pt-BR pack.
 */

const SNACK_SLOTS = [
  { menuItemIds: ["popcorn-lg"], categoryIds: [], quantity: 1 },
  { menuItemIds: [], categoryIds: ["drinks"], quantity: 2 },
];

function body(overrides: Partial<DiscountWriteBody> = {}): DiscountWriteBody {
  return {
    name: "Combo pipoca",
    type: "BUNDLE_PRICE",
    bundlePriceCents: 2_500,
    scope: "COMBO",
    trigger: "AUTOMATIC",
    comboRequirements: SNACK_SLOTS,
    stackable: true,
    active: true,
    ...overrides,
  };
}

function scalars(overrides: Partial<DiscountWriteBody> = {}) {
  return toDiscountScalars(toDiscountWriteInput(body(overrides)), PT_BR_DISCOUNTS_SERVER_COPY);
}

function targets(overrides: Partial<DiscountWriteBody> = {}) {
  return targetsForScope(toDiscountWriteInput(body(overrides)));
}

/** The form input a rejected write names, so a form can paint it. */
function fieldFor(overrides: Partial<DiscountWriteBody>): string {
  try {
    scalars(overrides);
  } catch (error) {
    if (error instanceof DiscountValidationError) return error.field;
    throw error;
  }
  return "<accepted>";
}

describe("a combo folds into its columns", () => {
  it("V1: keeps the bundle price and nulls every other value column", () => {
    expect(scalars()).toMatchObject({
      type: "BUNDLE_PRICE",
      bundlePriceCents: 2_500,
      freeUnits: null,
      percentOffBp: null,
      amountOffCents: null,
      scope: "COMBO",
    });
  });

  it("V2: keeps the free-unit count and nulls the bundle price", () => {
    const result = scalars({
      type: "FREE_UNITS",
      bundlePriceCents: null,
      freeUnits: 1,
      comboRequirements: [{ menuItemIds: ["burger"], categoryIds: [], quantity: 3 }],
    });
    expect(result).toMatchObject({ freeUnits: 1, bundlePriceCents: null, amountOffCents: null });
  });

  it("V3: accepts an ordinary percentage off a combo group", () => {
    const result = scalars({ type: "PERCENTAGE", bundlePriceCents: null, percentOffBp: 1_500 });
    expect(result).toMatchObject({ percentOffBp: 1_500, bundlePriceCents: null, freeUnits: null });
  });

  it("V4: carries the per-cart cap through, and null when it is not set", () => {
    expect(scalars({ maxComboApplications: 2 }).maxComboApplications).toBe(2);
    expect(scalars().maxComboApplications).toBeNull();
  });

  it("V5: stores the slots as targets, de-duplicated within each slot", () => {
    const result = targets({
      comboRequirements: [
        { menuItemIds: ["burger", "burger"], categoryIds: ["mains", "mains"], quantity: 2 },
      ],
    });
    expect(result.comboRequirements).toEqual([
      { menuItemIds: ["burger"], categoryIds: ["mains"], quantity: 2 },
    ]);
  });
});

describe("a combo reward only exists at combo scope", () => {
  it.each(["ORDER", "CATEGORY", "ITEM"] as const)(
    "V6: refuses a BUNDLE_PRICE discount scoped to %s",
    (scope) => {
      expect(fieldFor({ scope, categoryIds: ["c1"], menuItemIds: ["m1"] })).toBe("scope");
    },
  );

  it("V7: refuses a FREE_UNITS discount that is not a combo", () => {
    expect(
      fieldFor({ scope: "ITEM", type: "FREE_UNITS", bundlePriceCents: null, freeUnits: 1, menuItemIds: ["m1"] }),
    ).toBe("scope");
  });
});

describe("the slots", () => {
  it("V8: refuses a combo with no slots at all", () => {
    expect(fieldFor({ comboRequirements: [] })).toBe("comboRequirements");
  });

  it("V9: refuses a combo carrying more slots than a buyer could follow", () => {
    const tooMany = Array.from({ length: MAX_COMBO_SLOTS + 1 }, () => ({
      menuItemIds: ["x"],
      categoryIds: [],
      quantity: 1,
    }));
    expect(fieldFor({ comboRequirements: tooMany })).toBe("comboRequirements");
  });

  it("V10: refuses a slot naming neither a product nor a category", () => {
    expect(
      fieldFor({ comboRequirements: [{ menuItemIds: [], categoryIds: [], quantity: 1 }] }),
    ).toBe("comboRequirements");
  });

  it.each([0, -1, 1.5, MAX_COMBO_SLOT_QUANTITY + 1])(
    "V11: refuses a slot quantity of %s",
    (quantity) => {
      expect(
        fieldFor({ comboRequirements: [{ menuItemIds: ["x"], categoryIds: [], quantity }] }),
      ).toBe("comboRequirements");
    },
  );

  it("V12: refuses a per-cart cap of zero", () => {
    expect(fieldFor({ maxComboApplications: 0 })).toBe("maxComboApplications");
  });
});

describe("the reward columns", () => {
  it("V13: refuses a bundle with no price", () => {
    expect(fieldFor({ bundlePriceCents: null })).toBe("bundlePrice");
  });

  it("V14: refuses a bundle priced at zero, which is a giveaway and not a bundle", () => {
    expect(fieldFor({ bundlePriceCents: 0 })).toBe("bundlePrice");
  });

  it("V15: refuses a free-units combo with no count", () => {
    expect(fieldFor({ type: "FREE_UNITS", bundlePriceCents: null, freeUnits: null })).toBe(
      "freeUnits",
    );
  });

  it("V16: refuses a combo that gives away every unit it asks for", () => {
    // Three units per application, three of them free: the buyer pays nothing
    // for the group, which is not what a merchant means by "3 for the price of".
    expect(
      fieldFor({
        type: "FREE_UNITS",
        bundlePriceCents: null,
        freeUnits: 3,
        comboRequirements: [{ menuItemIds: ["burger"], categoryIds: [], quantity: 3 }],
      }),
    ).toBe("freeUnits");
  });

  it("V17: counts free units against EVERY slot, not just the first", () => {
    // One popcorn + two sodas is three units, so two free is legal and three is
    // not — the bound is the application's total, not any one slot's quantity.
    expect(
      fieldFor({ type: "FREE_UNITS", bundlePriceCents: null, freeUnits: 2 }),
    ).toBe("<accepted>");
    expect(fieldFor({ type: "FREE_UNITS", bundlePriceCents: null, freeUnits: 3 })).toBe("freeUnits");
  });
});

describe("scope narrowing", () => {
  it("V18: drops item and category targets from a combo, which targets through its slots", () => {
    const result = targets({ categoryIds: ["c1"], menuItemIds: ["m1"] });
    expect(result).toEqual({
      categoryIds: [],
      menuItemIds: [],
      comboRequirements: SNACK_SLOTS,
    });
  });

  it("V19: drops the slots from a discount that is no longer a combo", () => {
    const result = targets({
      scope: "ITEM",
      type: "PERCENTAGE",
      bundlePriceCents: null,
      percentOffBp: 1_000,
      menuItemIds: ["m1"],
    });
    expect(result.comboRequirements).toEqual([]);
  });

  it("V20: nulls every combo column on a discount that is not a combo", () => {
    const result = scalars({
      scope: "ORDER",
      type: "PERCENTAGE",
      bundlePriceCents: null,
      percentOffBp: 1_000,
      maxComboApplications: 5,
    });
    expect(result).toMatchObject({
      bundlePriceCents: null,
      freeUnits: null,
      maxComboApplications: null,
    });
  });
});
