/**
 * Every request input the package declares refuses a key it does not know, at
 * every depth (FUT-4729). The rule is the owner's: an extra key is a caller to
 * fix, never a field to ignore.
 */
import { describe, expect, it } from "vitest";

import {
  createDiscountBody,
  discountCollectionParams,
  discountItemParams,
  updateDiscountBody,
} from "../mcp";

const BODY = {
  name: "Ten off",
  type: "PERCENTAGE",
  percentOffBp: 1_000,
  scope: "ITEM",
  trigger: "AUTOMATIC",
  stackable: true,
  active: true,
  menuItemIds: ["m1"],
};

function unknownKeys(result: {
  success: boolean;
  error?: {
    issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }>;
  };
}) {
  return result.error?.issues
    .filter((issue) => issue.code === "unrecognized_keys")
    .map((issue) =>
      [...issue.path.map(String), ...(issue.keys ?? [])].join("."),
    );
}

describe("the write bodies are strict", () => {
  it("S1: accepts the documented body", () => {
    expect(createDiscountBody.safeParse(BODY).success).toBe(true);
    expect(
      updateDiscountBody.safeParse({ ...BODY, keepWindow: true }).success,
    ).toBe(true);
  });

  it("S2: refuses an unknown key at the top level on create and update", () => {
    expect(
      unknownKeys(createDiscountBody.safeParse({ ...BODY, clientId: "other" })),
    ).toEqual(["clientId"]);
    expect(
      unknownKeys(updateDiscountBody.safeParse({ ...BODY, id: "d1" })),
    ).toEqual(["id"]);
  });

  it("S3: refuses an unknown key inside a combo slot and a schedule window", () => {
    const combo = createDiscountBody.safeParse({
      ...BODY,
      comboRequirements: [{ menuItemIds: ["m1"], quantity: 1, price: 1 }],
    });
    expect(unknownKeys(combo)).toEqual(["comboRequirements.0.price"]);

    const schedule = createDiscountBody.safeParse({
      ...BODY,
      schedule: {
        windows: [{ days: [1], from: "10:00", to: "12:00", tz: "UTC" }],
      },
    });
    expect(unknownKeys(schedule)).toEqual(["schedule.windows.0.tz"]);
  });
});

describe("the path params are strict", () => {
  it("S4: refuses a param the route does not declare", () => {
    expect(
      discountCollectionParams.safeParse({ tenantSlug: "t" }).success,
    ).toBe(true);
    expect(
      discountCollectionParams.safeParse({ tenantSlug: "t", id: "d" }).success,
    ).toBe(false);
    expect(
      discountItemParams.safeParse({ tenantSlug: "t", id: "d", x: "y" })
        .success,
    ).toBe(false);
  });
});
