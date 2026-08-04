import { describe, it, expect } from "vitest";

import { parseSearchConfig, searchConfigSchema } from "./config";

describe("searchConfigSchema", () => {
  it("applies all defaults when no values provided", () => {
    expect(searchConfigSchema.parse({})).toEqual({ defaultPageSize: 20, maxPageSize: 500, maxSearchTermLength: 200 });
  });

  it("coerces string numbers to numeric values", () => {
    const config = searchConfigSchema.parse({ defaultPageSize: "10", maxPageSize: "100", maxSearchTermLength: "50" });
    expect(config).toEqual({ defaultPageSize: 10, maxPageSize: 100, maxSearchTermLength: 50 });
  });

  it("rejects zero values", () => {
    expect(() => searchConfigSchema.parse({ defaultPageSize: 0 })).toThrow();
    expect(() => searchConfigSchema.parse({ maxPageSize: 0 })).toThrow();
    expect(() => searchConfigSchema.parse({ maxSearchTermLength: 0 })).toThrow();
  });

  it("rejects negative values", () => {
    expect(() => searchConfigSchema.parse({ defaultPageSize: -1 })).toThrow();
    expect(() => searchConfigSchema.parse({ maxPageSize: -5 })).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() => searchConfigSchema.parse({ defaultPageSize: 1.5 })).toThrow();
  });
});

describe("parseSearchConfig", () => {
  it("maps env vars to config fields", () => {
    const config = parseSearchConfig({
      SEARCH_DEFAULT_PAGE_SIZE: "10",
      SEARCH_MAX_PAGE_SIZE: "100",
      SEARCH_MAX_TERM_LENGTH: "50",
    });
    expect(config).toEqual({ defaultPageSize: 10, maxPageSize: 100, maxSearchTermLength: 50 });
  });

  it("uses defaults for missing env vars", () => {
    expect(parseSearchConfig({})).toEqual({ defaultPageSize: 20, maxPageSize: 500, maxSearchTermLength: 200 });
  });

  it("ignores undefined env values", () => {
    const config = parseSearchConfig({ SEARCH_DEFAULT_PAGE_SIZE: undefined, SEARCH_MAX_PAGE_SIZE: "250" });
    expect(config.defaultPageSize).toBe(20);
    expect(config.maxPageSize).toBe(250);
  });
});
