import { describe, expect, it } from "vitest";

import { fromTargetRows, toTargetRows, type DiscountTargetRows } from "../targets";
import type { DiscountTargets } from "../validate";

/**
 * Unit: the fold between the id arrays this package speaks and the by-value
 * rows the schema stores.
 *
 * Mechanical code, and that is exactly why it has cases: a dropped slot
 * association produces a combo whose slots have silently MERGED — a rule that
 * still saves, still lists, and prices the wrong thing. Nothing about that
 * failure looks like a bug until a buyer is charged.
 */

function targets(overrides: Partial<DiscountTargets> = {}): DiscountTargets {
  return { categoryIds: [], menuItemIds: [], comboRequirements: [], ...overrides };
}

describe("out — a validated write becomes rows", () => {
  it("T1: tags each id with the dimension it came from", () => {
    expect(
      toTargetRows(targets({ categoryIds: ["c1"], menuItemIds: ["m1", "m2"] })).scopeTargets,
    ).toEqual([
      { targetType: "CATEGORY", targetId: "c1" },
      { targetType: "ITEM", targetId: "m1" },
      { targetType: "ITEM", targetId: "m2" },
    ]);
  });

  it("T2: keeps each slot's targets WITH that slot, never pooled", () => {
    const rows = toTargetRows(
      targets({
        comboRequirements: [
          { menuItemIds: ["popcorn"], categoryIds: [], quantity: 1 },
          { menuItemIds: [], categoryIds: ["drinks"], quantity: 2 },
        ],
      }),
    );
    expect(rows.comboSlots).toEqual([
      { position: 0, quantity: 1, targets: [{ targetType: "ITEM", targetId: "popcorn" }] },
      { position: 1, quantity: 2, targets: [{ targetType: "CATEGORY", targetId: "drinks" }] },
    ]);
  });

  it("T3: numbers the slots by their INDEX, so the operator's order survives", () => {
    // Two slots of the same size are indistinguishable once stored, and the
    // order is what a card reads the combo out in.
    const rows = toTargetRows(
      targets({
        comboRequirements: [
          { menuItemIds: ["a"], categoryIds: [], quantity: 2 },
          { menuItemIds: ["b"], categoryIds: [], quantity: 2 },
        ],
      }),
    );
    expect(rows.comboSlots.map((slot) => slot.position)).toEqual([0, 1]);
  });

  it("T4: writes nothing at all for an ORDER-scoped rule", () => {
    expect(toTargetRows(targets())).toEqual({ scopeTargets: [], comboSlots: [] });
  });
});

describe("in — rows become the arrays a record is built from", () => {
  it("T5: splits the scope targets back by dimension", () => {
    const stored: DiscountTargetRows = {
      scopeTargets: [
        { targetType: "ITEM", targetId: "m1" },
        { targetType: "CATEGORY", targetId: "c1" },
      ],
      comboSlots: [],
    };
    expect(fromTargetRows(stored)).toEqual({
      categoryIds: ["c1"],
      menuItemIds: ["m1"],
      comboRequirements: [],
    });
  });

  it("T6: SORTS the slots by position rather than trusting the row order", () => {
    // The order is part of what the combo means. A store that forgot its
    // `orderBy` would otherwise produce a subtly different offer on every read.
    const stored: DiscountTargetRows = {
      scopeTargets: [],
      comboSlots: [
        { position: 1, quantity: 2, targets: [{ targetType: "CATEGORY", targetId: "drinks" }] },
        { position: 0, quantity: 1, targets: [{ targetType: "ITEM", targetId: "popcorn" }] },
      ],
    };
    expect(fromTargetRows(stored).comboRequirements).toEqual([
      { menuItemIds: ["popcorn"], categoryIds: [], quantity: 1 },
      { menuItemIds: [], categoryIds: ["drinks"], quantity: 2 },
    ]);
  });
});

describe("round trip", () => {
  it("T7: survives out-and-back unchanged, slots and all", () => {
    const original = targets({
      categoryIds: ["c1", "c2"],
      menuItemIds: ["m1"],
      comboRequirements: [
        { menuItemIds: ["popcorn"], categoryIds: [], quantity: 1 },
        { menuItemIds: ["cola"], categoryIds: ["drinks"], quantity: 2 },
      ],
    });
    expect(fromTargetRows(toTargetRows(original))).toEqual({
      categoryIds: original.categoryIds,
      menuItemIds: original.menuItemIds,
      comboRequirements: original.comboRequirements,
    });
  });

  it("T8: does not let one slot's targets leak into another", () => {
    const rows = toTargetRows(
      targets({
        comboRequirements: [
          { menuItemIds: ["burger"], categoryIds: [], quantity: 2 },
          { menuItemIds: ["burger"], categoryIds: [], quantity: 1 },
        ],
      }),
    );
    // The SAME product in two slots, which is what a "buy 2 get 1" looks like.
    // Pooled, it would read as one slot of three.
    expect(fromTargetRows(rows).comboRequirements).toEqual([
      { menuItemIds: ["burger"], categoryIds: [], quantity: 2 },
      { menuItemIds: ["burger"], categoryIds: [], quantity: 1 },
    ]);
  });
});
