import { describe, expect, it } from "vitest";

import { columnsFor, LINE_SIZE_METRICS, LINE_SIZES, printableDotsFor } from "../index";

/**
 * The four sizes and their column counts.
 *
 * The table is the contract a host lays out against, so it is pinned value by
 * value: a change here moves where every sized line wraps.
 */

describe("columnsFor with a size", () => {
  it("pins the column table for both rolls", () => {
    const table = Object.fromEntries(
      LINE_SIZES.map((size) => [size, [columnsFor(58, size), columnsFor(80, size)]]),
    );

    expect(table).toEqual({
      small: [42, 64],
      medium: [32, 48],
      large: [21, 32],
      xlarge: [16, 24],
    });
  });

  it("answers the legacy Font A count when no size is given", () => {
    expect(columnsFor(58)).toBe(columnsFor(58, "medium"));
    expect(columnsFor(80)).toBe(columnsFor(80, "medium"));
  });

  it("falls back to the wider roll for any size", () => {
    expect(columnsFor(112, "xlarge")).toBe(24);
  });
});

describe("printableDotsFor", () => {
  it("is 48 mm of a 58 mm roll and 72 mm of an 80 mm one, at 8 dots/mm", () => {
    expect(printableDotsFor(58)).toBe(384);
    expect(printableDotsFor(80)).toBe(576);
  });
});

describe("LINE_SIZE_METRICS", () => {
  it("uses only ESC ! reachable steps: Font A or B, 1x or 2x", () => {
    for (const size of LINE_SIZES) {
      expect(["A", "B"]).toContain(LINE_SIZE_METRICS[size].font);
      expect([1, 2]).toContain(LINE_SIZE_METRICS[size].multiplier);
    }
  });
});
