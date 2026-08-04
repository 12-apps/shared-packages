import { describe, it, expect } from "vitest";

import { defineSearchConfig } from "./types";
import type { EntitySearchConfig } from "./types";

const valid: EntitySearchConfig = {
  searchableFields: ["name"],
  filterableFields: {
    name: { type: "string", operators: ["eq", "contains"] },
    priceCents: { type: "number", operators: ["gte", "lte"] },
  },
  sortableFields: ["name", "priceCents"],
  defaultSort: { field: "name", direction: "asc" },
};

describe("defineSearchConfig", () => {
  it("returns the config unchanged when valid", () => {
    expect(defineSearchConfig(valid)).toBe(valid);
  });

  it("requires at least one sortable field", () => {
    expect(() => defineSearchConfig({ ...valid, sortableFields: [] })).toThrow(/sortable field/);
  });

  it("requires defaultSort.field to be sortable", () => {
    expect(() => defineSearchConfig({ ...valid, defaultSort: { field: "ghost", direction: "asc" } })).toThrow(
      /must be in sortableFields/,
    );
  });

  it("rejects contains on a non-string field", () => {
    expect(() =>
      defineSearchConfig({
        ...valid,
        filterableFields: { priceCents: { type: "number", operators: ["contains"] } },
      }),
    ).toThrow(/"contains" operator is only valid on string/);
  });

  it("rejects gte/lte on a non-number/date field", () => {
    expect(() =>
      defineSearchConfig({
        ...valid,
        filterableFields: { name: { type: "string", operators: ["gte"] } },
      }),
    ).toThrow(/only valid on number or date/);
  });
});
