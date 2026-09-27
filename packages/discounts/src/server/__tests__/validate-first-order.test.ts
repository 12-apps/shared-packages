import { describe, expect, it } from "vitest";

import { PT_BR_DISCOUNTS_SERVER_COPY } from "../pt-BR";
import { toDiscountScalars, toDiscountWriteInput, type DiscountWriteBody } from "../validate";

/**
 * Unit (FUT-2825): the first-purchase condition on the write path.
 *
 * Driven through `toDiscountWriteInput` for the reason `validate-combo` is: an
 * omitted field and an older client's body have to fold the same way.
 */

function body(overrides: Partial<DiscountWriteBody> = {}): DiscountWriteBody {
  return {
    name: "Boas-vindas",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    scope: "ORDER",
    trigger: "AUTOMATIC",
    stackable: true,
    active: true,
    ...overrides,
  };
}

function firstOrderOnly(overrides: Partial<DiscountWriteBody>): boolean {
  return toDiscountScalars(toDiscountWriteInput(body(overrides)), PT_BR_DISCOUNTS_SERVER_COPY)
    .firstOrderOnly;
}

describe("the first-purchase condition on a write", () => {
  it("is stored when a merchant switches it on", () => {
    expect(firstOrderOnly({ firstOrderOnly: true })).toBe(true);
    expect(firstOrderOnly({ scope: "CATEGORY", categoryIds: ["c1"], firstOrderOnly: true })).toBe(
      true,
    );
  });

  it("is false when a body omits it, as every client before it does", () => {
    expect(firstOrderOnly({})).toBe(false);
  });

  it("is folded to false on a combo, which keeps its own rules", () => {
    expect(
      firstOrderOnly({
        type: "BUNDLE_PRICE",
        percentOffBp: null,
        bundlePriceCents: 2_500,
        scope: "COMBO",
        comboRequirements: [{ menuItemIds: ["m1"], categoryIds: [], quantity: 2 }],
        firstOrderOnly: true,
      }),
    ).toBe(false);
  });
});
