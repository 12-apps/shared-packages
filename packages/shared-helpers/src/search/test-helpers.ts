// Test helpers for the search engine — imported only from test files.
import { vi } from "vitest";

import type { SearchConfig } from "./config";
import type { EntitySearchConfig, SearchableModel } from "./types";

export function createMockSearchConfig(overrides?: Partial<SearchConfig>): SearchConfig {
  return { defaultPageSize: 20, maxPageSize: 500, maxSearchTermLength: 200, ...overrides };
}

export function createMockEntitySearchConfig(overrides?: Partial<EntitySearchConfig>): EntitySearchConfig {
  return {
    searchableFields: ["name", "email"],
    filterableFields: {
      name: { type: "string", operators: ["eq", "contains"] },
      email: { type: "string", operators: ["eq", "contains"] },
      createdAt: { type: "date", operators: ["gte", "lte"] },
    },
    sortableFields: ["createdAt", "name", "email"],
    defaultSort: { field: "createdAt", direction: "desc" },
    ...overrides,
  };
}

export function createMockSearchableModel(data: unknown[], total?: number): SearchableModel {
  return { findMany: vi.fn().mockResolvedValue(data), count: vi.fn().mockResolvedValue(total ?? data.length) };
}
