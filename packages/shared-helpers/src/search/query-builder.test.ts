import { describe, it, expect } from "vitest";

import { buildPrismaArgs, buildWhereClause } from "./query-builder";
import { createMockEntitySearchConfig } from "./test-helpers";
import type { EntitySearchConfig, ParsedSearchInput } from "./types";

const entityConfig = createMockEntitySearchConfig();

function makeInput(overrides: Partial<ParsedSearchInput> = {}): ParsedSearchInput {
  return { page: 1, pageSize: 20, sort: { field: "createdAt", direction: "desc" }, ...overrides };
}

describe("buildWhereClause", () => {
  it("returns undefined when no params", () => {
    expect(buildWhereClause(makeInput(), entityConfig)).toBeUndefined();
  });

  it("builds OR across searchable fields for q", () => {
    const result = buildWhereClause(makeInput({ q: "john" }), entityConfig);
    expect(result).toEqual({ OR: [{ name: { contains: "john" } }, { email: { contains: "john" } }] });
  });

  it("emits case-insensitive contains when searchMode is insensitive", () => {
    const insensitive: EntitySearchConfig = { ...entityConfig, searchMode: "insensitive" };
    const result = buildWhereClause(makeInput({ q: "john" }), insensitive);
    expect(result).toEqual({
      OR: [
        { name: { contains: "john", mode: "insensitive" } },
        { email: { contains: "john", mode: "insensitive" } },
      ],
    });
  });

  it("builds eq filter from bare field name", () => {
    expect(buildWhereClause(makeInput({ name: "John" }), entityConfig)).toEqual({ name: "John" });
  });

  it("builds contains filter", () => {
    expect(buildWhereClause(makeInput({ name_contains: "jo" }), entityConfig)).toEqual({ name: { contains: "jo" } });
  });

  it("builds gte filter", () => {
    const date = new Date("2024-01-01");
    expect(buildWhereClause(makeInput({ createdAt_gte: date }), entityConfig)).toEqual({ createdAt: { gte: date } });
  });

  it("builds lte filter", () => {
    const date = new Date("2024-12-31");
    expect(buildWhereClause(makeInput({ createdAt_lte: date }), entityConfig)).toEqual({ createdAt: { lte: date } });
  });

  it("builds neq filter", () => {
    const entityWithNeq: EntitySearchConfig = {
      searchableFields: [],
      filterableFields: { status: { type: "string", operators: ["neq"] } },
      sortableFields: ["createdAt"],
      defaultSort: { field: "createdAt", direction: "desc" },
    };
    expect(buildWhereClause(makeInput({ status_neq: "archived" }), entityWithNeq)).toEqual({ status: { not: "archived" } });
  });

  it("builds in filter", () => {
    const entityWithIn: EntitySearchConfig = {
      searchableFields: [],
      filterableFields: { status: { type: "string", operators: ["in"] } },
      sortableFields: ["createdAt"],
      defaultSort: { field: "createdAt", direction: "desc" },
    };
    expect(buildWhereClause(makeInput({ status_in: ["active", "pending"] }), entityWithIn)).toEqual({
      status: { in: ["active", "pending"] },
    });
  });

  it("combines multiple filters with AND", () => {
    const result = buildWhereClause(makeInput({ name: "John", email: "john@test.com" }), entityConfig);
    expect(result).toEqual({ AND: [{ name: "John" }, { email: "john@test.com" }] });
  });

  it("combines q with filters using AND", () => {
    const result = buildWhereClause(makeInput({ q: "john", name: "John" }), entityConfig);
    expect(result).toEqual({
      AND: [{ OR: [{ name: { contains: "john" } }, { email: { contains: "john" } }] }, { name: "John" }],
    });
  });

  it("handles null value for eq filter", () => {
    expect(buildWhereClause(makeInput({ name: null }), entityConfig)).toEqual({ name: null });
  });

  it("ignores q when searchableFields is empty", () => {
    const entityNoSearchable: EntitySearchConfig = {
      searchableFields: [],
      filterableFields: { status: { type: "string", operators: ["eq"] } },
      sortableFields: ["createdAt"],
      defaultSort: { field: "createdAt", direction: "desc" },
    };
    expect(buildWhereClause(makeInput({ q: "test" }), entityNoSearchable)).toBeUndefined();
  });
});

describe("buildPrismaArgs", () => {
  it("maps sort to orderBy", () => {
    const args = buildPrismaArgs(makeInput({ sort: { field: "email", direction: "asc" } }), entityConfig);
    expect(args.orderBy).toEqual({ email: "asc" });
  });

  it("calculates skip and take from page and pageSize", () => {
    const args = buildPrismaArgs(makeInput({ page: 3, pageSize: 10 }), entityConfig);
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it("calculates skip 0 for first page", () => {
    const args = buildPrismaArgs(makeInput({ page: 1, pageSize: 20 }), entityConfig);
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
  });

  it("passes through where clause", () => {
    const args = buildPrismaArgs(makeInput({ q: "test" }), entityConfig);
    expect(args.where).toEqual({ OR: [{ name: { contains: "test" } }, { email: { contains: "test" } }] });
  });
});
