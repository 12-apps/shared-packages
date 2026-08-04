import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  createSearchInput,
  createSearchOutput,
  parseSearchParamsResilient,
  parseSortParam,
} from "./schemas";
import { createMockSearchConfig, createMockEntitySearchConfig } from "./test-helpers";
import type { EntitySearchConfig } from "./types";

const globalConfig = createMockSearchConfig();

describe("parseSortParam", () => {
  it("parses valid sort string", () => {
    expect(parseSortParam("createdAt:desc")).toEqual({ field: "createdAt", direction: "desc" });
    expect(parseSortParam("email:asc")).toEqual({ field: "email", direction: "asc" });
  });

  it("throws on invalid format", () => {
    expect(() => parseSortParam("invalid")).toThrow("Invalid sort format");
  });

  it("throws on invalid direction", () => {
    expect(() => parseSortParam("field:up")).toThrow("Invalid sort direction");
  });
});

describe("createSearchInput", () => {
  const entityConfig = createMockEntitySearchConfig();

  it("applies defaults when no params provided", () => {
    const result = createSearchInput(entityConfig, globalConfig).parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.q).toBeUndefined();
    expect(result.sort).toEqual({ field: "createdAt", direction: "desc" });
  });

  it("coerces page and pageSize from strings", () => {
    const result = createSearchInput(entityConfig, globalConfig).parse({ page: "3", pageSize: "50" });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it("clamps pageSize to maxPageSize", () => {
    const schema = createSearchInput(entityConfig, createMockSearchConfig({ maxPageSize: 100 }));
    expect(() => schema.parse({ pageSize: "200" })).toThrow();
  });

  it("validates sort field against sortableFields", () => {
    expect(() => createSearchInput(entityConfig, globalConfig).parse({ sort: "invalid:asc" })).toThrow();
  });

  it("returns ZodError for malformed sort format (no colon)", () => {
    const result = createSearchInput(entityConfig, globalConfig).safeParse({ sort: "nocolon" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toContain("sort");
  });

  it("parses valid sort into SortParam", () => {
    const result = createSearchInput(entityConfig, globalConfig).parse({ sort: "email:asc" });
    expect(result.sort).toEqual({ field: "email", direction: "asc" });
  });

  it("transforms empty q to undefined and passes through non-empty q", () => {
    const schema = createSearchInput(entityConfig, globalConfig);
    expect(schema.parse({ q: "" }).q).toBeUndefined();
    expect(schema.parse({ q: "john" }).q).toBe("john");
  });

  it("splits in operator into an array", () => {
    const entityWithIn: EntitySearchConfig = {
      searchableFields: ["name"],
      filterableFields: { status: { type: "string", operators: ["eq", "in"] } },
      sortableFields: ["name"],
      defaultSort: { field: "name", direction: "asc" },
    };
    const result = createSearchInput(entityWithIn, globalConfig).parse({ status_in: "active,pending" });
    expect(result.status_in).toEqual(["active", "pending"]);
  });

  it("coerces boolean filter values from strings and accepts native booleans", () => {
    const entityWithBool: EntitySearchConfig = {
      searchableFields: [],
      filterableFields: { archived: { type: "boolean", operators: ["eq"] } },
      sortableFields: ["createdAt"],
      defaultSort: { field: "createdAt", direction: "desc" },
    };
    const schema = createSearchInput(entityWithBool, globalConfig);
    expect(schema.parse({ archived: "true" }).archived).toBe(true);
    expect(schema.parse({ archived: "false" }).archived).toBe(false);
    expect(schema.parse({ archived: true }).archived).toBe(true);
  });

  it("validates allowedValues on string eq filter", () => {
    const entityWithEnum: EntitySearchConfig = {
      searchableFields: [],
      filterableFields: { status: { type: "string", operators: ["eq"], allowedValues: ["active", "inactive"] } },
      sortableFields: ["createdAt"],
      defaultSort: { field: "createdAt", direction: "desc" },
    };
    const schema = createSearchInput(entityWithEnum, globalConfig);
    expect(schema.parse({ status: "active" }).status).toBe("active");
    expect(() => schema.parse({ status: "invalid" })).toThrow();
  });

  it("coerces date filter values", () => {
    const result = createSearchInput(entityConfig, globalConfig).parse({ createdAt_gte: "2024-01-01T00:00:00Z" });
    expect(result.createdAt_gte).toBeInstanceOf(Date);
  });

  it("transforms nullable string eq \"null\" to actual null", () => {
    const entityWithNullable: EntitySearchConfig = {
      searchableFields: [],
      filterableFields: { username: { type: "string", operators: ["eq"], nullable: true } },
      sortableFields: ["createdAt"],
      defaultSort: { field: "createdAt", direction: "desc" },
    };
    const result = createSearchInput(entityWithNullable, globalConfig).parse({ username: "null" });
    expect(result.username).toBeNull();
  });
});

describe("createSearchOutput", () => {
  it("wraps item schema in the paginated response shape", () => {
    const outputSchema = createSearchOutput(z.object({ id: z.string(), name: z.string() }));
    const result = outputSchema.parse({
      data: [{ id: "1", name: "Test" }],
      pagination: { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
    });
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it("rejects invalid data items", () => {
    const outputSchema = createSearchOutput(z.object({ id: z.string() }));
    expect(() =>
      outputSchema.parse({
        data: [{ invalid: true }],
        pagination: { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false, hasPreviousPage: false },
      }),
    ).toThrow();
  });
});

describe("parseSearchParamsResilient", () => {
  const entity: EntitySearchConfig = {
    searchableFields: ["name"],
    filterableFields: { status: { type: "string", operators: ["in"], allowedValues: ["A", "B"] } },
    sortableFields: ["name"],
    defaultSort: { field: "name", direction: "asc" },
  };
  const schema = createSearchInput(entity, globalConfig);

  it("returns the parsed data unchanged when every param is valid", () => {
    const result = parseSearchParamsResilient(schema, { q: "ana", page: "2" });
    expect(result.q).toBe("ana");
    expect(result.page).toBe(2);
  });

  it("drops only the malformed param and keeps the other valid filters", () => {
    // `page=oops` alone is invalid; strict parse would discard the valid `q` too.
    const result = parseSearchParamsResilient(schema, { q: "ana", page: "oops" });
    expect(result.q).toBe("ana");
    expect(result.page).toBe(1); // fell back to the schema default for page only
  });

  it("drops an out-of-range filter value while keeping the search", () => {
    const result = parseSearchParamsResilient(schema, { q: "ana", status_in: "BOGUS" });
    expect(result.q).toBe("ana");
    expect(result.status_in).toBeUndefined();
  });

  it("falls back to all defaults when the cleaned input still won't parse", () => {
    // A required-shape violation that can't be isolated to a droppable key still
    // yields a valid defaulted object rather than throwing.
    const result = parseSearchParamsResilient(schema, { page: "oops", pageSize: "nope" });
    expect(result.page).toBe(1);
    expect(result.q).toBeUndefined();
  });
});
